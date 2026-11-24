// En la versión publicada como página, Phaser se carga desde cdnjs como variable global.
const PhaserGlobal = (window as unknown as { Phaser: typeof import('phaser') }).Phaser;
export default PhaserGlobal;
