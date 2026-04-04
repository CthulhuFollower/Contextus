export const NASA_EYES_CONFIG = {
  staticUrl: "https://eyes.nasa.gov/apps/exo/assets",
  dynamicUrl: "https://eyes.nasa.gov/assets/dynamic",
  starDbUrl: "https://eyes.nasa.gov/assets/dynamic/exo/db/EyesExoStarDatabaseCombined.bin",
  planetDbUrl: "https://eyes.nasa.gov/assets/dynamic/exo/db/EyesExoPlanetDatabase.bin",
  candidateDbUrl: "https://eyes.nasa.gov/assets/dynamic/exo/db/EyesExoCandidateDatabase.bin",
  tessCandidateDbUrl: "https://eyes.nasa.gov/assets/dynamic/exo/db/EyesExoTessCandidateDatabase.bin"
};

const EXO_DB_MAGIC = 1163415344;

// En el bundle original la rotacion usa Fd(w, x, y, z).
const ECLIPTIC_TO_J2000 = {
  w: 0.9791532214288992,
  x: 0.2031230389823101,
  y: 0,
  z: 0
};

class BinaryReader {
  constructor(buffer) {
    this.view = new DataView(buffer);
    this.offset = 0;
  }

  isAtEnd() {
    return this.offset >= this.view.byteLength;
  }

  readByte() {
    const value = this.view.getUint8(this.offset);
    this.offset += 1;
    return value;
  }

  readFloat32() {
    const value = this.view.getFloat32(this.offset, true);
    this.offset += 4;
    return value;
  }

  readFloat64() {
    const value = this.view.getFloat64(this.offset, true);
    this.offset += 8;
    return value;
  }

  readUInt16() {
    const value = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return value;
  }

  readInt16() {
    const value = this.view.getInt16(this.offset, true);
    this.offset += 2;
    return value;
  }

  readInt64() {
    const value = Number(this.view.getBigInt64(this.offset, true));
    this.offset += 8;
    return Number.isSafeInteger(value) ? value : Number.NaN;
  }

  readString(length) {
    const bytes = [];

    for (;;) {
      const value = this.readByte();
      if (length === undefined && value === 0) {
        break;
      }

      bytes.push(value);

      if (length !== undefined && bytes.length === length) {
        break;
      }
    }

    return new TextDecoder().decode(new Uint8Array(bytes));
  }
}

function rotateVectorByQuaternion(quaternion, vector) {
  const ix =
    quaternion.w * vector.x +
    quaternion.y * vector.z -
    quaternion.z * vector.y;
  const iy =
    quaternion.w * vector.y +
    quaternion.z * vector.x -
    quaternion.x * vector.z;
  const iz =
    quaternion.w * vector.z +
    quaternion.x * vector.y -
    quaternion.y * vector.x;
  const iw =
    -quaternion.x * vector.x -
    quaternion.y * vector.y -
    quaternion.z * vector.z;

  return {
    x: ix * quaternion.w - iw * quaternion.x - iy * quaternion.z + iz * quaternion.y,
    y: iy * quaternion.w - iw * quaternion.y - iz * quaternion.x + ix * quaternion.z,
    z: iz * quaternion.w - iw * quaternion.z - ix * quaternion.y + iy * quaternion.x
  };
}

function toJ2000Position(position) {
  const remapped = {
    x: position[2],
    y: -position[0],
    z: position[1]
  };

  return rotateVectorByQuaternion(ECLIPTIC_TO_J2000, remapped);
}

function normalizeBooleanStrings(record) {
  const keys = Object.keys(record);
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    if (record[key] === "True") {
      record[key] = true;
    } else if (record[key] === "False") {
      record[key] = false;
    }
  }
}

function parseRecordField(reader, type) {
  switch (type) {
    case -1:
    case 1: {
      const length = reader.readInt16();
      return reader.readString(length);
    }
    case 4:
      return reader.readFloat64();
    case 5:
      return [reader.readFloat32(), reader.readFloat32()];
    case 8:
      return [reader.readFloat64(), reader.readFloat64(), reader.readFloat64()];
    default:
      throw new Error(`Tipo de campo no soportado en la base exo: ${type}`);
  }
}

function enrichPlanetRecord(record) {
  const visTypeMap = {
    Terrestrial: "Terrestrial",
    "super-Terrestrial": "Super Earth",
    Jovian: "Gas Giant",
    "sub-Jovian": "Gas Giant",
    "super-Jovian": "Gas Giant",
    Neptunian: "Neptune-like",
    "sub-Neptunian": "Neptune-like"
  };

  if (!record.visType && record.plType) {
    record.visType = visTypeMap[record.plType] || record.plType || "Unknown";
  }
}

function enrichStarRecord(record, planetsArray) {
  if (record.position) {
    record.positionJ2000 = toJ2000Position(record.position);
  }

  if (Array.isArray(planetsArray)) {
    const planets = planetsArray
      .filter(planet => planet.pl_hostname === record.exo_id)
      .map(planet => planet.exo_id);
    record.planets = planets;
  }

  if (
    record.displayName?.startsWith("WD") ||
    /^D.{0,2}$/.test(record.st_spectype || "") ||
    record.st_spectype === "WD"
  ) {
    record.starType = "WD";
  }
}

export function parseExoDatabase(arrayBuffer, type, context = {}) {
  const reader = new BinaryReader(arrayBuffer);
  const magic = reader.readInt64();

  if (magic !== EXO_DB_MAGIC) {
    throw new Error(`Magic number invalido para base exo: ${magic}`);
  }

  const fieldCount = reader.readUInt16();
  const fields = [];

  for (let i = 0; i < fieldCount; i += 1) {
    const fieldType = reader.readInt16();
    const fieldNameLength = reader.readInt16();
    const fieldName = reader.readString(fieldNameLength);
    fields.push({ type: fieldType, key: fieldName });
  }

  const items = [];
  const byId = {};

  while (!reader.isAtEnd()) {
    const idLength = reader.readInt16();
    const id = reader.readString(idLength);
    const record = { id };

    for (let i = 0; i < fields.length; i += 1) {
      const field = fields[i];
      record[field.key] = parseRecordField(reader, field.type);
    }

    normalizeBooleanStrings(record);

    if (type === "planets") {
      enrichPlanetRecord(record);
    }

    if (type === "stars") {
      enrichStarRecord(record, context.planetsArray);
    }

    byId[record.exo_id] = record;
    items.push(record);
  }

  return { items, byId };
}

async function fetchArrayBuffer(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`No se pudo descargar ${url}: ${response.status}`);
  }

  return response.arrayBuffer();
}

export async function loadExoDbFromUrl(url, type, context = {}) {
  const buffer = await fetchArrayBuffer(url);
  return parseExoDatabase(buffer, type, context);
}

export async function loadNasaExoDatabases() {
  const planets = await loadExoDbFromUrl(NASA_EYES_CONFIG.planetDbUrl, "planets");
  const stars = await loadExoDbFromUrl(NASA_EYES_CONFIG.starDbUrl, "stars", {
    planetsArray: planets.items
  });

  return {
    config: NASA_EYES_CONFIG,
    planets,
    stars
  };
}

