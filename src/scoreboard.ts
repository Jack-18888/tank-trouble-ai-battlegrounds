import type { Game } from './engine.ts';
import { getBotType } from './bots/index.ts';
import { tankIcon } from './renderer.ts';

const entities: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
const escapeHTML = (value: string) => value.replace(/[&<>"']/g, (char) => entities[char]);

/** Shared by the live match display and browser fixtures. Both totals cover the whole match. */
export function scoreCards(game: Game): string {
  return game.tanks
    .map((tank) => {
      const status = game.players.get(tank.id)?.status;
      const role =
        tank.controller.kind === 'human'
          ? 'THE HUMAN'
          : escapeHTML(getBotType(tank.controller.botId)?.label ?? tank.controller.botId) +
            ' BOT' +
            (status === 'failed' ? ' · OFFLINE' : '');
      const wins = game.scores[tank.id];
      const kills = game.kills[tank.id];
      return `<div class="score-card ${tank.alive ? '' : 'eliminated'}" data-tank="${tank.id}" data-controller-status="${status}" style="color:${tank.color}">
      ${tankIcon(tank.color, 'score-tank')}
      <span class="score-info">
        <span class="score-name">${escapeHTML(tank.name)}${tank.id === game.humanId ? ' <span style="opacity:.5">/ P1</span>' : ''}</span>
        <span class="score-sub">${role}</span>
        <span class="score-kills" aria-label="${kills} kills this match"><strong data-score="kills">${kills}</strong><span>KILLS</span></span>
      </span>
      <span class="score-total" aria-label="${wins} round wins this match"><strong class="score-number" data-score="wins">${wins}</strong><span class="score-caption">WINS</span></span>
    </div>`;
    })
    .join('');
}
