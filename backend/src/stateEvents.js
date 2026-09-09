import { EventEmitter } from 'node:events';

// Canal en memoria entre el POST que recibe el estado del ESP32 y las
// conexiones SSE abiertas por los navegadores. Railway ejecuta hoy una sola
// instancia del backend; si en el futuro se escala horizontalmente, este
// canal debera reemplazarse por Postgres LISTEN/NOTIFY o Redis pub/sub.
const stateEvents = new EventEmitter();
stateEvents.setMaxListeners(0);

export function publishDeviceState(update) {
  stateEvents.emit('estado', update);
}

export function subscribeToDeviceState(listener) {
  stateEvents.on('estado', listener);
  return () => stateEvents.off('estado', listener);
}
