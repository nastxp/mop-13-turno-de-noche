import Phaser from 'phaser';
import { generateAllTextures } from '../gfx/sprites';
import { playerLook } from '../data/crew';
import { randomSeedString } from '../core/Rng';
import { saves } from '../systems/SaveManager';
import { ui } from '../ui/UI';

/** Genera todo el pixel art en tiempo de carga y arranca el menú con la nave de fondo. */
export class BootScene extends Phaser.Scene {
  constructor() { super('Boot'); }

  create() {
    const look = saves.data.look;
    generateAllTextures(this, playerLook(look.uniform, look.hat));
    this.registry.set('lookKey', JSON.stringify(look));
    ui.refreshIcons();
    this.scene.start('Game', { mode: 'attract', night: 1, seed: randomSeedString(), difficulty: 0.6, duration: null });
    ui.showMenu();
    // la pantalla de carga desaparece cuando la nave de fondo ya se ha dibujado
    let frames = 0;
    const hide = () => { if (++frames < 3) return; document.getElementById('boot')?.remove(); this.game.events.off(Phaser.Core.Events.POST_RENDER, hide); };
    this.game.events.on(Phaser.Core.Events.POST_RENDER, hide);
  }
}
