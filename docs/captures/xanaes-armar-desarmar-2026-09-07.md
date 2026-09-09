# Captura — armar y desarmar con clave de usuario — 2026-09-07

- **Archivo**: `xanaes-armar-desarmar-2026-09-07.csv`
- **Qué se hizo**: procedimiento normal de armado con clave, seguido del procedimiento
  normal de desarmado, todo en una sesión de captura continua.

## Resultado: armar/desarmar es indistinguible de teclear 4 dígitos sueltos

No aparece ningún tamaño de ráfaga nuevo — solo los dos ya conocidos (22 = tecla,
145 = refresco de display). La secuencia es: 4 ráfagas cortas (una por dígito) seguidas
de ráfagas de refresco cercanas en el tiempo (patrón "entrada rápida", como con la
casita+clave), tanto para armar como para desarmar.

**El latido de fondo (~125ms de período) no cambia** antes, durante ni después de armar
o desarmar — sin diferencia detectable a este nivel de captura.

Conclusión práctica: si en algún momento se replica esta secuencia (transmisión), no
hace falta manejar ningún frame especial de "confirmación de armado" — alcanza con
reproducir los 4 códigos de tecla en secuencia, igual que para cualquier entrada de
dígitos.

## Validación adicional de la tabla

Los 4 dígitos decodificaron igual tanto en el armado como en el desarmado (mismo código
de usuario para ambos, como es de esperar) — tercera confirmación independiente de la
tabla de 12 teclas, en un tercer contexto de uso real distinto.
