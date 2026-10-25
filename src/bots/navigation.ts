import { distance } from '../math.ts';
import type { Point } from '../types.ts';
import type { BotContext } from './types.ts';

// Keep following a cell center after crossing into that cell. Rebuilding the
// next waypoint from cellAt(self) each decision makes a tank turn back toward
// the center it just left, especially at corridor corners.
export class MazeNavigator {
  private route: number[] = [];
  private cursor = 0;
  private goal = -1;
  private mapSeed = '';

  waypoint(context: BotContext, target: Readonly<Point>): Point {
    const { self, map, rules } = context;
    const from = context.cellAt(self.x, self.y);
    const goal = context.cellAt(target.x, target.y);
    if (
      goal !== this.goal ||
      map.seed !== this.mapSeed ||
      !this.route.length ||
      (from !== this.route[this.cursor] && from !== this.route[this.cursor - 1])
    ) {
      this.route = context.findPath(from, goal);
      this.cursor = 0;
      this.goal = goal;
      this.mapSeed = map.seed;
    }
    const center = (id: number): Point => ({
      x: (map.cells[id].x + 0.5) * rules.cellSize,
      y: (map.cells[id].y + 0.5) * rules.cellSize,
    });
    let next = center(this.route[this.cursor] ?? from);
    while (this.cursor < this.route.length - 1 && distance(self, next) <= 5) {
      next = center(this.route[++this.cursor]);
    }
    return next;
  }
}
