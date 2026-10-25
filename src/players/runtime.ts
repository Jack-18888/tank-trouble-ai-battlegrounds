import type { Game } from '../engine.ts';
import { RULES } from '../rules.ts';
import { HumanConnection } from './human-connection.ts';
import { freezeTree } from '../bots/context.ts';
import type { PlayerInput } from '../types.ts';
import type {
  BotConnectionFactory,
  ConnectionEvents,
  PlayerConnection,
  RoundInit,
} from './connection.ts';

/** Owns player lifetimes and observation delivery; the game only executes accepted controls. */
export class PlayerRuntime {
  readonly connections = new Map<number, PlayerConnection>();
  private readonly tokens = new Map<number, { active: boolean }>();
  private readonly physicsStep: (dt: number) => void;
  private roundKey = '';
  private epoch = -1;
  private state: Game['state'] = 'ready';
  private nextObservation = 0;
  private input: Readonly<PlayerInput> = {};
  private disposed = false;
  private lastWall: number;

  constructor(
    readonly game: Game,
    private readonly botFactory: BotConnectionFactory,
    private readonly now: () => number = () => performance.now(),
  ) {
    this.physicsStep = game.update.bind(game);
    this.lastWall = now();
  }
  sync() {
    if (this.disposed) return;
    const game = this.game;
    if (game.state === 'ready') return;
    const roundKey = `${game.generation}:${game.round}`;
    if (roundKey !== this.roundKey) {
      this.closeConnections();
      this.roundKey = roundKey;
      this.nextObservation = 0;
      this.lastWall = this.now();
      for (const tank of game.tanks) {
        if (!tank.alive) continue;
        const token = { active: true };
        this.tokens.set(tank.id, token);
        const init: RoundInit = {
          generation: game.generation,
          round: game.round,
          playerId: tank.id,
          botId: tank.controller.kind === 'bot' ? tank.controller.botId : 'human',
          seed: `${game.map.seed}:${game.round}:${tank.id}`,
          map: structuredClone(game.map),
          rules: RULES,
        };
        const events: ConnectionEvents = {
          ready: (profile) => {
            if (
              token.active &&
              game.generation === init.generation &&
              game.round === init.round &&
              game.tanks[tank.id]?.alive
            )
              game.playerReady(tank.id, profile);
          },
          decision: (envelope) => {
            if (token.active) game.submitDecision(tank.id, envelope);
          },
          failed: (reason) => {
            if (
              token.active &&
              game.generation === init.generation &&
              game.round === init.round &&
              game.tanks[tank.id]?.alive
            ) {
              token.active = false;
              game.playerFailed(tank.id, reason);
              this.connections.get(tank.id)?.dispose();
            }
          },
        };
        try {
          const connection =
            tank.controller.kind === 'human'
              ? new HumanConnection(init, events)
              : this.botFactory(init, events);
          this.connections.set(tank.id, connection);
          if (!token.active) connection.dispose();
        } catch (error) {
          events.failed(error instanceof Error ? error.message : 'Could not start bot worker.');
        }
      }
    }
    if (this.epoch !== game.epoch || this.state !== game.state) {
      for (const connection of this.connections.values()) connection.invalidate();
      this.nextObservation = game.elapsed;
      this.lastWall = this.now();
      if (game.state === 'paused' || this.state === 'paused') this.input = {};
      this.epoch = game.epoch;
      this.state = game.state;
      if (game.state === 'playing') this.publishInput();
    }
    for (const [id, connection] of this.connections) {
      if (!game.tanks[id]?.alive || game.state === 'roundOver' || game.state === 'matchOver') {
        const token = this.tokens.get(id);
        if (token) token.active = false;
        connection.dispose();
        game.playerClosed(id);
      }
    }
  }
  setInput(input: Readonly<PlayerInput>) {
    if (this.disposed) return;
    this.sync();
    this.input = Object.freeze({ ...input });
    this.publishInput();
  }
  private publishInput() {
    const game = this.game;
    if (game.state !== 'playing' || game.humanId === null) return;
    this.connections.get(game.humanId)?.setInput?.(this.input, game.controlStamp());
  }
  step(dt: number) {
    if (this.disposed) return;
    this.sync();
    const now = this.now();
    const wall = Math.max(0, now - this.lastWall);
    this.lastWall = now;
    if (this.game.state === 'playing' || this.game.state === 'countdown') {
      for (const connection of this.connections.values()) connection.advance(wall);
    }
    this.physicsStep(dt);
    this.sync();
    const game = this.game;
    if (game.state !== 'playing' || game.elapsed + 1e-9 < this.nextObservation) return;
    this.nextObservation = game.elapsed + 1 / 30;
    const frame = game.snapshot();
    freezeTree(frame);
    for (const [id, connection] of this.connections) {
      if (game.tanks[id]?.alive && game.players.get(id)?.status !== 'failed')
        connection.observe(frame);
    }
  }
  private closeConnections() {
    for (const token of this.tokens.values()) token.active = false;
    for (const connection of this.connections.values()) connection.dispose();
    this.connections.clear();
    this.tokens.clear();
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.closeConnections();
    for (const tank of this.game.tanks) this.game.playerClosed(tank.id);
    this.input = {};
  }
}
