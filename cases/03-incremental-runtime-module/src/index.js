globalThis.buildMarker = 'initial';
globalThis.run = async () => {
  const a = await import(/* webpackChunkName: "a" */ './a.js');
  const b = await a.load();
  return b.value;
};
