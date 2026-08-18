# tools/

Scripts de PC (Python, solo librería estándar — sin `pip install`) que procesan datos
ya capturados por el firmware. Ver `docs/decisions/0004-analisis-python.md` para por
qué esto vive acá y no en `firmware/`.

## `analyze_capture.py` (Etapa 4)

Analiza un CSV de `docs/captures/` (formato de la Etapa 3): clusters de ancho de pulso
por nivel, detección de huecos de trama, comparación de tramas por símbolo (tolerante
al jitter de reloj real). No decodifica ningún protocolo — muestra evidencia, la
interpretación queda para el humano.

```
python tools/analyze_capture.py docs/captures/archivo.csv
python tools/analyze_capture.py docs/captures/archivo.csv --gap-ratio 8 --cluster-ratio 1.5
python tools/analyze_capture.py docs/captures/archivo.csv --report docs/captures/archivo-analisis.txt
```

En Windows, si `python` resuelve al stub de Microsoft Store, usar `py` en su lugar.

### Tests

```
cd tools
py -m unittest test_analyze_capture -v
```
