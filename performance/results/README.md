# Resultados Generados

Este directorio recibe los reportes crudos producidos por los runners y
laboratorios de `performance/`.

Los archivos JSON no se versionan porque son regenerables, voluminosos y no son
consumidos por la aplicacion ni por la suite automatica. Las conclusiones,
comparaciones y decisiones aceptadas deben registrarse en
`performance/observations.md`.

Reglas:

1. Generar reportes JSON localmente dentro de este directorio.
2. No depender de un reporte historico para ejecutar pruebas o laboratorios.
3. Registrar en `observations.md` la configuracion y las metricas necesarias
   para justificar una decision.
4. Conservar respaldos externos solo cuando sea necesario retener muestras
   crudas para una auditoria puntual.
