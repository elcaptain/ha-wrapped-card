# Home Assistant Wrapped

A year-in-review story for your smart home, in the style of a "Wrapped" recap. A dashboard card opens a full-screen, tap-through story built from your own Home Assistant data.

## Slides

1. Intro
2. Integrations added this year, by month
3. Where it started: first and most recent integration
4. New devices, ranked by integration
5. Top brand and the room that got the most new devices
6. Apps installed
7. Tinkering habits (night owl, weekend warrior or daytime tinkerer)
8. Energy: total kWh, hardest-working device, hungriest month
9. Climate: warmest indoor reading, outdoor peak, average per room
10. Your home today: entities, automations, devices, areas
11. Home personality (The Maker, The Mesh Master, The Automator, …)
12. Shareable summary card

Slides without data are skipped. For example, the energy slide only appears if you have energy sensors with long-term statistics.

## Install

### HACS / Marketplace (custom repository)

1. Open **Settings** > **Marketplace** (or HACS on Home Assistant 2026.10 and older).
2. Add `https://github.com/elcaptain/ha-wrapped-card` as a custom repository of type **Dashboard**.
3. Install **Home Assistant Wrapped**. The dashboard resource is registered for you.
4. Reload the browser.

### Manual

Download `ha-wrapped-card.js` from the [latest release](https://github.com/elcaptain/ha-wrapped-card/releases/latest), copy it to `/config/www/`, and add `/local/ha-wrapped-card.js` as a dashboard resource of type **module**.

### Add the card

Installing only adds the card; it doesn't create a dashboard. Add it to any dashboard through **Add card** > **Home Assistant Wrapped**, or in YAML:

```yaml
type: custom:ha-wrapped-card
year: 2026 # optional, defaults to the current year
```

A **panel** view gives the card a full-width spot of its own.

The card needs an **admin** user, because it reads the registries and recorder statistics over the websocket API.

## How it works

The card uses only built-in websocket commands, so no backend integration is needed:

| Data | Source |
|---|---|
| Integrations added | `config_entries/get` (`created_at`) |
| Devices, brands, rooms | `config/device_registry/list`, `config/area_registry/list` |
| Entity counts | `config/entity_registry/list` |
| Integration names | `manifest/list` |
| Energy and temperature | `recorder/list_statistic_ids` and `recorder/statistics_during_period` (monthly) |

Data collection starts in the background when the dashboard loads. The result is cached in the browser's `localStorage` for 6 hours, so the story opens instantly after the first run.

## Limitations

- Stats such as "most toggled light" or "most triggered automation" aren't included. The recorder keeps detailed state history for only 10 days by default; supporting them would need a companion integration that counts all year.
- The energy totals cover only devices with energy sensors. Several sensors on one device are counted once.
- The temperature stats use monthly min/max values, so a sensor that reads high, for example one heated by its own chip, can win "warmest room".

## Development

`preview.html` runs the card outside Home Assistant with a mock `hass` object and a snapshot of sample data:

```bash
python3 -m http.server 8765
```

Then open <http://localhost:8765/preview.html>. Add `#play` to the URL to open the story right away, or `?slow` to simulate a slow instance.
