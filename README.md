# Home Assistant Unwrapped

A year-in-review story for your home. A dashboard card opens a full-screen, tap-through story built from your own Home Assistant data.

## Slides

1. Intro
2. Integrations added this year, by month
3. Local: the share of your integrations that run in your home
4. New devices, ranked by integration
5. Brands: every manufacturer in your home, and this year's top brand
6. Made by you: ESPHome devices you built yourself
7. Automations created this year, how many came from a blueprint, and the oldest one still around
8. Apps installed
9. Tinkering habits (night owl, weekend warrior or daytime tinkerer)
10. Energy: total kWh, hardest-working device, hungriest month
11. Solar: what your panels made and the share used at home
12. Climate: warmest indoor reading, outdoor peak, average per room
13. Your home today: entities, automations, devices, areas
14. Home personality (The Maker, The Mesh Master, The Automator, …)
15. Shareable summary card

Slides without data are skipped. For example, the energy slide only appears if you have energy sensors with long-term statistics, and the solar slide only if a solar source is set up in the energy dashboard and produced energy this year.

## Install

### HACS / Marketplace (custom repository)

1. Open **Settings** > **Marketplace** (or HACS on Home Assistant 2026.10 and older).
2. Add `https://github.com/elcaptain/ha-wrapped-card` as a custom repository of type **Dashboard**.
3. Install **Home Assistant Unwrapped**. The dashboard resource is registered for you.
4. Reload the browser.

### Manual

Download `ha-wrapped-card.js` from the [latest release](https://github.com/elcaptain/ha-wrapped-card/releases/latest), copy it to `/config/www/`, and add `/local/ha-wrapped-card.js` as a dashboard resource of type **module**.

### Add the card

Installing only adds the card; it doesn't create a dashboard. Add it to any dashboard through **Add card** > **Home Assistant Unwrapped**, or in YAML:

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
| Integration names, local or cloud | `manifest/list` (`iot_class`) |
| Energy and temperature | `recorder/list_statistic_ids` and `recorder/statistics_during_period` (monthly) |
| Solar and grid return | `energy/get_prefs`, then the same statistics |
| Automations from a blueprint | `config/automation/config/<id>` (REST, for this year's automations, up to 50) |

Data collection starts in the background when the dashboard loads. The result is cached in the browser's `localStorage` for 6 hours, so the story opens instantly after the first run.

## Limitations

- Stats such as "most toggled light" or "most triggered automation" aren't included. The recorder keeps detailed state history for only 10 days by default; supporting them would need a companion integration that counts all year.
- The energy totals cover only devices with energy sensors. Several sensors on one device are counted once.
- ESPHome devices are "made by you" unless the maker set an ESPHome project, which ready-made devices do. A DIY device with its own project set counts as ready-made.
- Automation dates come from the ID the automation editor gives each automation, which is the moment it was created. Automations written in YAML with other IDs use the entity registry date, and aren't used for "oldest still around".
- The temperature stats use monthly min/max values, so a sensor that reads high, for example one heated by its own chip, can win "warmest room".

## License

[MIT](LICENSE)
