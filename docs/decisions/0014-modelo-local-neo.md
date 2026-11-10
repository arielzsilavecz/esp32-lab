# ADR-0014: Modelo de lenguaje local en NEO (ordenes escritas para las luces)

## Estado

Aceptado

## Fecha

2026-11-10

## Contexto

El usuario quiere darle ordenes en lenguaje natural a la casa desde el tablero, y
mas adelante usar el mismo modelo para analizar imagenes de las camaras y como
asistente. Todo en NEO: sin servicios de IA externos y sin cargar Railway.

NEO es un AMD A6-9225 (2 nucleos, AVX2, limitado a 1,9 GHz por temperatura) con
7,2 GB de RAM. Medicion (llama.cpp b12255, CPU, 2 hilos, Q4_K_M):

| Modelo       | Lee      | Escribe  | Ordenes (6) | Imagen de la camara              |
|--------------|----------|----------|-------------|----------------------------------|
| Qwen3.5 0.8B | 17,7 t/s | 5,0 t/s  | 3 bien      | Vio una persona donde hay un perro |
| Qwen3.5 2B   | 7,1 t/s  | 2,4 t/s  | 6 bien      | Correcto ("perro, sin personas")   |

Temperatura maxima bajo carga sostenida: 76 °C, sin bajar de 1,9 GHz.

## Decision

- **Motor: llama.cpp `llama-server`**, binario oficial, servicio
  `tools/neo-llm/neo-llm.service`: solo 127.0.0.1, un pedido a la vez, `Nice=15`,
  `CPUWeight=20`, `MemoryMax=4G`, sin razonamiento (`--reasoning off`).
- **Modelo: Qwen3.5 2B Q4_K_M.** El 0.8B es mas rapido pero se equivoca en ordenes
  y alucina en imagenes. El 2B trae vision (`mmproj`, para la etapa de camaras).
- **Cargado siempre** (~2,6 GB). Dormirlo pierde el prompt ya procesado: la
  primera orden pasaria de ~15 s a ~50 s.
- **Ordenes: dispositivo `asistente`, comando `interpretar`.** La pagina manda el
  texto; el backend le agrega los nombres actuales de los focos (se renombran desde
  la pagina). Llega a NEO por la espera larga existente (ADR-0013). El puente:
  1. **Reglas** para lo simple ("apagá el living", "prendé todas"): al instante.
  2. Si no encaja, el **modelo** con salida forzada a un esquema JSON (gramatica)
     cuyo campo `luz` solo admite los ids de los focos.
  3. Corrige lo que el modelo mezcla (temperatura y color juntos) y valida con
     la misma funcion que las ordenes de la pagina (`ajuste_a_ha`).
  4. Ejecuta directo en Home Assistant y responde por `POST /estado`
     (`{orden, texto, respuesta}` o `{orden, pensando: true}`), que la pagina
     recibe por el canal en vivo.
- **Solo luces.** Porton y disyuntor quedan fuera por pedido del usuario: el
  esquema no tiene forma de nombrarlos y el puente solo conoce las luces.

## Alternativas consideradas

- **Ollama**: mas comodo para cambiar de modelo, pero agrega una capa (y Docker)
  sobre el mismo llama.cpp. Para un modelo fijo no aporta.
- **Solo reglas**: instantaneo, pero no entiende "bajá el living a la mitad" ni
  "todo en verde". Quedan como primer paso, el modelo cubre el resto.
- **Interpretar en Railway con una API de IA**: rapido, pero sale de la casa y
  cuesta; contradice el objetivo.

## Consecuencias

- Orden simple: al instante. Con modelo: 5-25 s (la primera tras reiniciar o
  renombrar un foco, ~50 s).
- Railway: un pedido por orden escrita y uno o dos reportes de respuesta.
- NEO: 2,6 GB de RAM fijos; CPU al 100 % solo mientras interpreta.
- Proxima etapa: vigilancia de camara con "Estoy afuera" y refuerzo por Z1/Z2,
  analizada en NEO, con aviso y foto (ADR aparte).
