import { CELL } from './engine.ts';
import { TANK_SHAPES, SHELL_RADIUS, WALL_RADIUS } from './geometry.ts';
import type { Game } from './engine.ts';
import type { GameMap, Tank, Powerup } from './types.ts';

function canvasContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D is required to render the game.');
  return context;
}

export function tankIcon(color: string, className = ''): string {
  return `<svg class="${className}" viewBox="0 0 32 36" aria-hidden="true"><rect x="3" y="10" width="6" height="24" rx="2" fill="${color}"/><rect x="23" y="10" width="6" height="24" rx="2" fill="${color}"/><rect x="10" y="13" width="12" height="18" rx="3" fill="${color}"/><circle cx="16" cy="20" r="5" fill="${color}" stroke="#f6f5ef" stroke-width="1"/><rect x="14" y="2" width="4" height="18" rx="1" fill="${color}"/></svg>`;
}

export class Renderer {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly reducedMotion: boolean;
  readonly observer: ResizeObserver;
  width = 0;
  height = 0;
  dpr = 1;
  cachedMap: GameMap | null = null;
  floor = document.createElement('canvas');

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvasContext(canvas);
    this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas);
    this.resize();
  }
  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.width = rect.width;
    this.height = rect.height;
    this.dpr = dpr;
    this.canvas.width = Math.round(rect.width * dpr);
    this.canvas.height = Math.round(rect.height * dpr);
    this.cachedMap = null;
  }
  draw(game: Game, time: number) {
    if (!this.width || !this.height) return;
    const ctx = this.ctx,
      { map } = game;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.fillStyle = '#dce3c8';
    ctx.fillRect(0, 0, this.width, this.height);
    const pad = this.width < 450 ? 19 : 27;
    const scale = Math.min(
      (this.width - pad * 2) / map.width,
      (this.height - pad * 2) / map.height,
    );
    const ox = (this.width - map.width * scale) / 2,
      oy = (this.height - map.height * scale) / 2;
    ctx.save();
    const shake = this.reducedMotion ? 0 : game.shake;
    ctx.translate(ox + (Math.random() - 0.5) * shake, oy + (Math.random() - 0.5) * shake);
    ctx.scale(scale, scale);
    if (this.cachedMap !== map) this.cacheMap(map);
    ctx.drawImage(this.floor, -8, -8);
    for (const track of game.tracks) {
      ctx.save();
      ctx.translate(track.x, track.y);
      ctx.rotate(track.angle);
      ctx.globalAlpha = Math.min(0.13, track.life / 50);
      ctx.fillStyle = '#566445';
      ctx.fillRect(-2, -12, 3, 5);
      ctx.fillRect(-2, 7, 3, 5);
      ctx.restore();
    }
    for (const tank of game.tanks.filter((t) => !t.alive)) {
      ctx.save();
      ctx.translate(tank.x, tank.y);
      ctx.rotate(tank.angle);
      ctx.fillStyle = '#65734c25';
      ctx.beginPath();
      ctx.ellipse(0, 0, 22, 17, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#53613e55';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-6, -5);
      ctx.lineTo(6, 5);
      ctx.moveTo(6, -5);
      ctx.lineTo(-6, 5);
      ctx.stroke();
      ctx.restore();
    }
    for (const p of game.powerups) this.drawPowerup(p, time);
    for (const shell of game.bullets) {
      for (let i = 0; i < shell.trail.length; i++) {
        const point = shell.trail[i];
        ctx.globalAlpha = (i / shell.trail.length) * 0.35;
        ctx.fillStyle = '#e1b65e';
        ctx.beginPath();
        ctx.arc(point.x, point.y, (2.5 * i) / shell.trail.length, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#faf1bd';
      ctx.beginPath();
      ctx.arc(shell.x, shell.y, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#455034';
      ctx.beginPath();
      ctx.arc(shell.x, shell.y, SHELL_RADIUS, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const tank of game.tanks.filter((t) => t.alive)) this.drawTank(tank, time, game);
    for (const p of game.particles) {
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
    ctx.fillStyle = '#6c7f5066';
    ctx.font = '7px Consolas, monospace';
    ctx.textAlign = 'center';
    for (let c = 0; c < map.cols; c += map.cols > 12 ? 2 : 1)
      ctx.fillText(String(c + 1).padStart(2, '0'), ox + (c + 0.5) * CELL * scale, oy - 10);
    ctx.textAlign = 'left';
    if (game.humanId !== null && !game.tanks[game.humanId].alive && game.state === 'playing') {
      ctx.fillStyle = '#f4f6e8e8';
      ctx.fillRect(this.width / 2 - 100, this.height - 26, 200, 20);
      ctx.fillStyle = '#61734e';
      ctx.font = '8px Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.fillText('YOU’RE OUT · WATCH THE TROUBLE', this.width / 2, this.height - 13);
    }
  }
  cacheMap(map: GameMap) {
    const floor = document.createElement('canvas');
    floor.width = map.width + 16;
    floor.height = map.height + 16;
    const ctx = canvasContext(floor);
    ctx.translate(8, 8);
    ctx.fillStyle = '#e1e7cf';
    ctx.fillRect(0, 0, map.width, map.height);
    for (const cell of map.cells) {
      if ((cell.x * 13 + cell.y * 7) % 5 === 0) {
        ctx.fillStyle = '#dce3c9';
        ctx.fillRect(cell.x * CELL, cell.y * CELL, CELL, CELL);
      }
    }
    ctx.fillStyle = '#75865a20';
    for (let x = 16; x < map.width; x += 16)
      for (let y = 16; y < map.height; y += 16) ctx.fillRect(x, y, 1, 1);
    ctx.strokeStyle = '#89996b12';
    ctx.lineWidth = 1;
    for (let x = CELL; x < map.width; x += CELL) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, map.height);
      ctx.stroke();
    }
    for (let y = CELL; y < map.height; y += CELL) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(map.width, y);
      ctx.stroke();
    }
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const walls = (color: string, width: number, yOffset: number) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      for (const wall of map.walls) {
        ctx.moveTo(wall.x1, wall.y1 + yOffset);
        ctx.lineTo(wall.x2, wall.y2 + yOffset);
      }
      ctx.stroke();
    };
    walls('#66784c30', 9, 4);
    walls('#52623f', WALL_RADIUS * 2, 0);
    walls('#819064', 1, -1.5);
    ctx.fillStyle = '#b3bd96';
    for (const cell of map.cells) {
      if (cell.x % 3 === 0 && cell.y % 3 === 0 && cell.walls[0] && cell.walls[3]) {
        ctx.beginPath();
        ctx.arc(cell.x * CELL, cell.y * CELL, 1.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    this.floor = floor;
    this.cachedMap = map;
  }
  drawTank(tank: Tank, time: number, game: Game) {
    const ctx = this.ctx;
    const human = tank.id === game.humanId;
    if (human) {
      ctx.strokeStyle = `${tank.color}40`;
      ctx.lineWidth = 1.2;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.arc(tank.x, tank.y, 25, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (tank.shield) {
      ctx.strokeStyle = '#73aeb7';
      ctx.lineWidth = 2;
      ctx.fillStyle = '#c4e4df22';
      ctx.beginPath();
      ctx.arc(tank.x, tank.y, 23 + Math.sin(time * 4) * 1.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.save();
    ctx.translate(tank.x, tank.y);
    ctx.rotate(tank.angle);
    ctx.fillStyle = '#34402b20';
    ctx.beginPath();
    ctx.ellipse(1, 4, 19, 14, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#394333';
    for (const shape of TANK_SHAPES.slice(0, 2))
      this.roundRect(shape.x, shape.y, shape.w, shape.h, shape.r);
    ctx.fillStyle = '#718164';
    for (const [phase, y] of [
      [tank.leftTread, -13],
      [tank.rightTread, 8],
    ]) {
      for (let x = -12 + (((phase % 5) + 5) % 5); x < 14; x += 5) ctx.fillRect(x, y, 1.5, 5);
    }
    const hull = TANK_SHAPES[2],
      barrel = TANK_SHAPES[3];
    ctx.fillStyle = tank.color;
    this.roundRect(hull.x, hull.y, hull.w, hull.h, hull.r);
    ctx.fillStyle = '#ffffff2a';
    this.roundRect(-10, -7, 21, 3, 1);
    ctx.fillStyle = '#00000015';
    ctx.fillRect(-10, 6, 21, 2);
    ctx.fillStyle = '#344332';
    this.roundRect(barrel.x, barrel.y, barrel.w, barrel.h, barrel.r);
    ctx.fillStyle = tank.color;
    ctx.fillRect(4, -2, 17, 4);
    ctx.fillStyle = tank.color;
    ctx.beginPath();
    ctx.arc(-1, 0, 7.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#f5f4d975';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#ffffff22';
    ctx.beginPath();
    ctx.arc(-2, -2, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f1eed6b0';
    ctx.fillRect(-3, -2, 3, 3);
    ctx.restore();
    if (tank.power) {
      ctx.fillStyle = '#c09536';
      ctx.font = 'bold 15px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(tank.power === 'rapid' ? 'ϟ' : '⋔', tank.x, tank.y - 25);
    }
    ctx.font = `${human ? 'bold ' : ''}9px Consolas, monospace`;
    ctx.textAlign = 'center';
    ctx.fillStyle = human ? tank.color : '#61734dbb';
    ctx.fillText(human ? 'YOU' : tank.name.toUpperCase(), tank.x, tank.y + 30);
    if (human && game.state === 'playing') {
      const active = game.bullets.filter((b) => b.owner === tank.id).length;
      for (let i = 0; i < 5; i++) {
        ctx.fillStyle = `${tank.color}${i < 5 - active ? '99' : '20'}`;
        ctx.fillRect(tank.x - 11 + i * 5, tank.y + 35, 3, 2);
      }
    }
  }
  roundRect(x: number, y: number, w: number, h: number, r: number) {
    this.ctx.beginPath();
    this.ctx.roundRect(x, y, w, h, r);
    this.ctx.fill();
  }
  drawPowerup(p: Powerup, time: number) {
    const ctx = this.ctx,
      symbols = { shield: '◇', rapid: 'ϟ', scatter: '⋔' };
    if (p.life < 3 && Math.sin(time * 12) < 0) return;
    ctx.save();
    ctx.translate(p.x, p.y + (this.reducedMotion ? 0 : Math.sin(time * 3) * 2));
    ctx.fillStyle = '#5f714829';
    ctx.beginPath();
    ctx.ellipse(0, 12, 13, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = p.type === 'shield' ? '#ddecee' : '#f4e7bb';
    ctx.strokeStyle = p.type === 'shield' ? '#77a0a9' : '#baa055';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(-12, -12, 24, 24, 4);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = p.type === 'shield' ? '#5e8e9b' : '#b08b38';
    ctx.font = 'bold 24px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(symbols[p.type], 0, 1);
    ctx.restore();
  }
}
