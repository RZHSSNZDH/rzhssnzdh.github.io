# گنجورند · Ganjoorand (web)

A web rewrite of [GGanjoorand](https://framagit.org/RZHSSNZDH/gganjoorand)
(GTK 4 app) in plain HTML / CSS / JavaScript. It pulls a random poem from
[Ganjoor](https://ganjoor.net) through the official API and shows it with
the recitation player, copy and open-on-Ganjoor actions.

No build step, no npm, no framework. The only runtime dependency is Python 3
(for the tiny local server).

## Run on Arch Linux

```bash
sudo pacman -S --needed python            # usually already installed
cd ganjoorand-web
python3 server.py --open                  # http://127.0.0.1:8000
```

Optional, for nicer Persian typography:

```bash
sudo pacman -S --needed noto-fonts ttf-dejavu
yay -S vazirmatn-fonts                    # AUR; check the name with: yay -Ss vazirmatn
```

Any other static server works too (`python3 -m http.server`, `npx serve`, ...),
but if the browser blocks direct calls to api.ganjoor.net (CORS), only
`server.py` provides the `/gapi` fallback proxy.

## What you can type

| Input | Example |
|---|---|
| Full URL | `https://ganjoor.net/hafez/ghazal/` |
| Path parts | `hafez/ghazal`, `hafez ghazal`, `moulavi shams ghazalsh` |
| Poet name | `hafez`, `حافظ`, `moulavi` |
| Nothing | repeats your last search |

## Shortcuts

`Enter` search · `Ctrl+R` or `R` another poem · `/` focus search · `Space` play / pause

## Extras over the GTK app

Light/dark theme, adjustable verse size, bookmarks, search history with
suggestions, a recitation picker with seek bar, shareable `#p<id>` links,
responsive layout (hemistichs stack on phones), print stylesheet.

Everything is stored in your browser's localStorage; nothing leaves it.

## Files

```
index.html     page + icon sprite
css/style.css  design
js/api.js      Ganjoor API client (port of api.py)
js/app.js      UI
server.py      static server + /gapi proxy (stdlib only)
```

## License

GPL-3.0-or-later, same as the original. Poems are served by Ganjoor.
