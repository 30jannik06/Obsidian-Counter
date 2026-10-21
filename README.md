# Counter

Simple tally counters in the right sidebar — like the lap counters runners used to click at the track. Add as many as you want, each with its own name, count, and step size.

## Install (manual / dev)

1. `npm install`
2. `npm run build` (or `npm run dev` for watch mode)
3. Make sure this folder sits at `<vault>/.obsidian/plugins/obsidian-counter/`
4. Reload Obsidian, enable "Counter" in Settings → Community plugins

## Use

- Ribbon icon or command "Open counters panel" opens the sidebar view.
- "+ Add counter" creates a new one — give it a name.
- Click the name to rename, ✕ to delete.
- Big **+** / **−** buttons change the count by the step size (default 1); set a custom step per counter.
- ⟲ resets a counter to 0.

Everything is saved automatically to the plugin's data file.
