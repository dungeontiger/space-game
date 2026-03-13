## Star Generator (subproject)

This tool generates a random set of **systems** (each with 1–5 stars) and writes them into the main app’s `public/universe_definition.json`.

- **Systems**: each system has 1, 2, 3, 4, or 5 stars; percentage chance for each type is configurable (must total 100%). Default: 1-star 60%, 2-star 30%, 3-star 5%, 4-star 4%, 5-star 1%.
- **Unique names**: each system and each star gets a unique name.
- **Non-uniform distributions**: choose between `uniform`, `clustered`, and `disk`
- **Parameters persisted**: saved inside `universe_definition.json` as a special `type: "meta"` entry with `id: "__generator__"`
- **Safe write**: before overwriting `universe_definition.json`, the tool writes/overwrites a single backup `universe_definition.json.bak`
- **Reference data**: star and system types are read from JSON in `data/` (see below).

### Reference data (`data/`)

- **`star-types.json`** – One entry per stellar type (M, K, G, F, A, B, O). Each has:
  - `id`, `spectralClass`, `name` (e.g. "Red Dwarf", "Yellow Dwarf")
  - `diameterKmMin`, `diameterKmMax` – diameter range in km
  - `massSolarMin`, `massSolarMax` – mass range in solar masses
  - `color` – hex color for the 3D viewer
- **`system-types.json`** – Five entries (1–5 stars per system). Each has:
  - `starCount`, optional `description`
  - `starTypeChances` – object mapping star type id (e.g. `"M"`, `"G"`) to percentage chance for a star in that system size. Percentages per entry should sum to 100.

The generator picks a system size from the UI percentages (pct1–pct5), then for each star in that system picks a star type from the matching `system-types` entry and assigns radius (from the type’s diameter range) and color.

### Run

From the Space Game root (`c:\dev\space-game`):

```bash
cd tools/star-generator
npm install
npm run dev
```

Then open the URL shown in the terminal (defaults to `http://127.0.0.1:5174`).

### What it writes

`public/universe_definition.json` becomes an array like:

- First element: generator metadata
- Remaining elements: systems (each with a `stars` array)

Example system entry:

```json
{
  "id": "system-1",
  "type": "system",
  "name": "Alpha System",
  "position": { "x": 0, "y": 0, "z": 0 },
  "stars": [
    { "id": "system-1-star-1", "name": "Alpha Prime", "position": { "x": 0, "y": 0, "z": 0 }, "radius": 696000, "color": "white" },
    { "id": "system-1-star-2", "name": "Alpha Secondary", "position": { "x": 0.01, "y": 0, "z": 0 }, "radius": 696000, "color": "white" }
  ]
}
```

Example metadata entry:

```json
{
  "id": "__generator__",
  "type": "meta",
  "position": { "x": 0, "y": 0, "z": 0 },
  "name": "Generator",
  "generator": {
    "tool": "star-generator",
    "version": 1,
    "generatedAt": "2026-02-21T12:34:56.000Z",
    "params": { "...": "..." },
    "systemCount": 200,
    "starCount": 250
  }
}
```

### Notes

- System centers are generated within **±(diameter/2)** in each axis; stars in a system are placed at small offsets from the center.
- Star **radius** and **color** come from `data/star-types.json`; which type is chosen depends on the system’s star count and `data/system-types.json` chances.
- Existing contents of `universe_definition.json` are replaced (after creating `universe_definition.json.bak`).

