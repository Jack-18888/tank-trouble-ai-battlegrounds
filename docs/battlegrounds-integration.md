# Battlegrounds bot integration

Each model competitor owns a folder under `src/bots/`. Only the three local
model branches supply competitors. The shared catalog makes them available in
browser and Node workers alongside the built-in Easy, Medium, and Hard bots.

| Bot ID        | Folder        | Local source branch / commit |
| ------------- | ------------- | ---------------------------- |
| ds-v41-flash  | ds-flash      | DS-v4.1-flash / dc396de      |
| gpt-6-1-sol   | gpt-6-1-sol   | gpt-6-1-sol / 8880b43        |
| gpt-6-1-terra | gpt-6-1-terra | gpt-6-1-terra / 86a95c4      |

Original movement, firing profiles, and decision horizons are preserved. Folder
moves only change import paths. Integration retains the current `battlegrounds`
engine, scheduling, observations, and simulation tooling. DS behavioral tests
use a controlled clock for its internal computation valve; worker execution
continues to use real deadlines.

The browser check verifies that the model catalog contains exactly these three
competitors and runs them in real browser workers.

The hosting manifest targets the existing Model Battle Arena Site:
<https://tank-trouble-model-battle-arena.jack-shi-smart.chatgpt.site/>.
Publishing requires pushing matching source to its Sites repository first.
