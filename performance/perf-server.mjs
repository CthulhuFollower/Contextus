import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, normalize, resolve } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    port: { type: "string", default: "8778" },
    output: { type: "string", default: "performance/results/perf-browser.json" }
  }
});
const root = resolve(".");
const outputPath = resolve(values.output);
const port = Number(values.port);
const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".bin": "application/octet-stream",
  ".webmanifest": "application/manifest+json"
};

function pathInsideRoot(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const relative = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  const absolute = resolve(root, normalize(relative));
  return absolute.startsWith(root) ? absolute : null;
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks);
}

const server = createServer(async (request, response) => {
  try {
    if (request.method === "POST" && request.url === "/__perf_result") {
      const body = await readBody(request);
      JSON.parse(body.toString("utf8"));
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, Buffer.concat([body, Buffer.from("\n")]));
      response.writeHead(204);
      response.end();
      console.log(`Browser performance report written to ${outputPath}`);
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405);
      response.end();
      return;
    }
    const filePath = pathInsideRoot(request.url || "/");
    if (!filePath) {
      response.writeHead(403);
      response.end();
      return;
    }
    const data = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": contentTypes[extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    response.end(request.method === "HEAD" ? undefined : data);
  } catch (error) {
    response.writeHead(error.code === "ENOENT" ? 404 : 500, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(error.message);
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Performance server listening on http://127.0.0.1:${port}`);
});
