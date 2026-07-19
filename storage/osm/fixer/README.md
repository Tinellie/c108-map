# OSM Fixer

This tool performs a four-step geometry cleanup workflow for OSM XML:

1. Rotate the full map by a given angle.
2. Orthogonalize segments that are close to horizontal or vertical.
3. Align nearby nodes and connected nodes to shared horizontal/vertical axes.
4. Rotate geometry back to the original direction.

Additional refinements:

- Keep nearby segments with similar angles as parallel as possible.
- Straighten similar-angle consecutive segments on the same way.
- Remove unnecessary middle nodes on nearly straight segments.
- Delete empty nodes that have no tags and are no longer referenced.
- Optionally snap all nodes to a virtual square grid in rotated space.

## Install

```bash
cd fixer
npm install
```

## Usage

```bash
node src/index.js <input.osm> <output.osm> [options]
```

### Recommended Simple Usage

Only tune these most of the time:

- `--angle <degrees>`
- `--preset <soft|balanced|strong>`
- `--grid-size <meters>`

Options:

- `--angle <degrees>`: rotation angle before cleanup. Default `0`
- `--preset <soft|balanced|strong>`: processing intensity preset. Default `balanced`
- `--clockwise`: interpret the angle as clockwise
- `--ortho-threshold <degrees>`: tolerance for near-horizontal/vertical segment detection. Default `8`
- `--parallel-angle <degrees>`: max angle difference for nearby segments to be parallelized. Default `6`
- `--parallel-distance <meters>`: nearby midpoint distance for parallelization. Default `12`
- `--parallel-strength <0..1>`: blend strength for parallelization. Default `0.35`
- `--proximity <meters>`: threshold for nearby node alignment. Default `1.2`
- `--connected <meters>`: threshold for connected-node alignment. Default `0.9`
- `--straighten-angle <degrees>`: max angle drift inside one way-run for straightening. Default `7`
- `--straighten-offset <meters>`: max offset allowed when straightening way-run nodes. Default `1.5`
- `--straighten-strength <0..1>`: blend strength for run straightening. Default `1`
- `--simplify-offset <meters>`: max offset from line when removing middle nodes. Default `0.2`
- `--simplify-angle <degrees>`: max turning angle for removable middle nodes. Default `3`
- `--grid-size <meters>`: snap all nodes to nearest virtual grid point after rotation. `0` disables it. Default `0`
- `--iterations <count>`: number of iterative passes. Default `4`

## Example

```bash
node src/index.js ../7.fixed.osm ./output.osm --angle -34 --preset balanced --grid-size 1.0
```

Suggested starting value for grid snapping: `--grid-size 1.0` (meters).

If needed, all advanced parameters are still available to override preset defaults.
