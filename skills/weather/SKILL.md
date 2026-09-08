# Weather

Use `exec` and `curl` for current weather or forecasts because they need fresh data. Ask for a location if neither the request nor usable conversation context gives one. URL-encode the location and use wttr.in without an API key, preferably one concise request such as `curl -fsS --max-time 15 "https://wttr.in/Amsterdam?format=3"`. Do not make repeated calls when one response is enough. Explain a failed request rather than inventing weather data. Do not use this Skill for general meteorology, historical climate, official emergency alerts, aviation, or marine weather.
