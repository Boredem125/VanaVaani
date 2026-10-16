# VanaVaani

**The forest's voice sets the daily tourist quota and entry fee. The surge pays the people who protect it.**

VanaVaani ("forest voice") is a prototype for the Emerge for Good Innovation Challenge, Responsible Tourism track. It targets eco-sites in India's small states that get too many visitors, such as the root bridges in Meghalaya, the lakes in Sikkim and Ousteri Lake in Puducherry.

## How it works

1. **Listen.** Local guides record a 1-minute clip on any phone at fixed listening posts: dawn, noon and dusk. One post sits off-trail, away from tourists, as the **control**.
2. **Measure.** The phone computes four standard ecoacoustic indices. Raw audio never leaves the phone.

   | Index | What it measures | Source |
   |---|---|---|
   | NDSI | Nature sound (2–11 kHz) against human sound (1–2 kHz) | Kasten et al. 2012 |
   | ACI | How much bird and insect calls vary over time | Pieretti et al. 2011 |
   | ADI | How evenly sound is spread across frequency bands | Villanueva-Rivera et al. 2011 |
   | BI | How loud nature sound is in the 2–8 kHz range | Boelman et al. 2007 |

3. **Decide.** Forest Health Score = trail quality ÷ control quality. Comparing against the control removes the effect of season and weather. Rainy clips are filtered out, and the score is smoothed over 3 days. From the score:
   - **Tomorrow's quota:** 100% of capacity at a score of 85 or more, falling to a 25% floor.
   - **Entry fee:** the base fee at 85 or more, rising to 3.5× the base when the forest is stressed.
4. **Book.** Tourists book through a WhatsApp bot and pay by UPI. They receive a signed QR pass, and the guide checks it at the gate. On stressed days the bot suggests healthier villages nearby.
5. **Pay.** The base fee goes to the village committee. Of the surge, **70% goes to forest guardians** and 30% to a restoration fund. Guardians get a monthly bonus when the score improves.

## What is real and what is simulated

| Real (runs in the browser) | Simulated (labelled in the app) |
|---|---|
| Microphone capture, audio-file upload, FFT, all four indices, rain filter, duplicate-clip fingerprint, health score, quota and fee rules, signed QR passes, gate verification | 30-day site history, the WhatsApp chat, UPI payment, species names on the postcard, the one-year back-test |

Demo soundscapes (healthy forest, tourist crowd, heavy rain) are synthesised in code, so no third-party recordings are used.

## Run locally

Requirements: Python 3 and Node 18+. There is no build step and nothing to install.

```bash
python -m http.server 5173
```

Open http://localhost:5173.

```bash
node tests/indices.test.mjs
```

The tests check that forest sound scores Thriving, crowd noise scores Critical, rain is flagged, quota and fee move the right way, and a re-uploaded clip is caught.

## Deploy

The repository root is a static site. Import it in Vercel with no framework preset and no build command. `vercel.json` grants microphone, camera and geolocation access to the page itself.

## Guided tour for judges

Share **https://vanavaani.vercel.app/?tour** and the guided tour starts by itself. It's a 12-step walkthrough:

- A spotlight moves from feature to feature, and an animated cursor taps the controls.
- In Judge mode, the tour can play the forest and crowd soundscapes for you.
- Tick **Auto-play** to run the whole tour hands-free.

First-time visitors also get a "Take the tour" prompt. The **Guided tour** button in the top bar restarts it at any time. Use arrow keys to step through and Esc to exit.

## Finale demo script (3 minutes)

1. **Forest health tab (30 s).** Nongriat Root Bridges is selected. Point out the health dial, tomorrow's quota and fee, the fee split, and the 30-day chart showing the dip from the festival weekend.
2. **Judge mode, Healthy forest (30 s).** Open Judge mode and press **Healthy forest**. Birdsong plays and the live spectrogram fills the 2–11 kHz band. The score rises to about 90, the quota goes to full and the fee drops to the base.
3. **Judge mode, Tourist crowd (30 s).** Press **Tourist crowd**. Voices, horns and speaker music fill 1–2 kHz. The score falls to about 25, the quota drops to the floor and the fee rises to about 3.5× the base. The dashboard changes behind the panel.
4. **Book tab (45 s).** Book 2 people. The bot reports the forest is stressed and offers Riwai or Padu. Book anyway, pay with the simulated UPI, and receive the QR pass. Show the split: so much to the village, so much to the guardians.
5. **Gate tab (20 s).** Press **Use my latest booking**: entry allowed. Press it again: already used.
6. **Guardians and Back-test tabs (25 s).** Show the guardians' earnings, then the year-long comparison: fewer critical days, and more income reaching locals.

Closing line: *"Today humans guess what a forest can take. VanaVaani lets the forest answer, and pays the people who keep it singing."*

## Roadmap

- BirdNET species identification
- YAMNet alerts for chainsaws and gunshots
- WhatsApp Business API and UPI collect requests
- A forest-department dashboard
- Monthly manual bird counts by guides to check the scores against the ground

## Project layout

```
index.html            app shell and tabs
css/                  styles.css (tokens), listen.css, book.css, insights.css
js/indices.js         FFT, spectrogram, NDSI/ACI/ADI/BI, rain and fingerprint
js/synth.js           synthetic soundscapes
js/score.js           health score, quota, fee, fee split
js/store.js           sites, seeded history, recordings, bookings, passes
js/audio.js           mic, scene playback, live analyser, spectrogram renderer
js/judge.js           Judge mode panel
js/pass.js            HMAC-signed QR passes
js/postcard.js        shareable forest postcard
js/charts.js          Chart.js theme helper
js/views/*.js         dashboard, listen, book, gate, guardians, backtest, pitch
tests/                Node tests for the acoustic pipeline
```
