// Shared by the server and the browser: sun times, phase of day and the Indian season (ritu).
// Pure maths, no network, so the sky works even on a static host with no server at all.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TahalSky = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  // NOAA solar approximation. Returns UTC ms for sunrise/sunset on calendar day (y, m, d),
  // or a polar marker when the sun never rises/sets.
  function sunTimes(lat, lon, y, m, d) {
    const rad = Math.PI / 180;
    const base = Date.UTC(y, m, d);
    const dayOfYear = Math.round((base - Date.UTC(y, 0, 0)) / 864e5);
    const g = ((2 * Math.PI) / 365) * (dayOfYear - 1);
    const eqtime =
      229.18 *
      (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
    const decl =
      0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) +
      0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
    const cosH = Math.cos(90.833 * rad) / (Math.cos(lat * rad) * Math.cos(decl)) - Math.tan(lat * rad) * Math.tan(decl);
    if (cosH > 1) return { polar: 'night' };
    if (cosH < -1) return { polar: 'day' };
    const ha = Math.acos(cosH) / rad;
    return {
      sunrise: base + (720 - 4 * (lon + ha) - eqtime) * 60000,
      sunset: base + (720 - 4 * (lon - ha) - eqtime) * 60000,
    };
  }

  function seasonFor(lat, month) {
    const north = ['winter', 'winter', 'spring', 'spring', 'spring', 'summer', 'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter'];
    const s = north[month];
    return lat >= 0 ? s : { winter: 'summer', summer: 'winter', spring: 'autumn', autumn: 'spring' }[s];
  }

  // The six traditional Indian seasons, by calendar month (approximate; north India).
  const RITUS = [
    { name: 'Shishir', gist: 'cool, foggy late winter' },   // Jan
    { name: 'Shishir', gist: 'cool, foggy late winter' },   // Feb
    { name: 'Vasant', gist: 'spring, new leaves, mild air' }, // Mar
    { name: 'Vasant', gist: 'spring, new leaves, mild air' }, // Apr
    { name: 'Grishma', gist: 'hot, dry summer' },            // May
    { name: 'Grishma', gist: 'hot, dry summer' },            // Jun
    { name: 'Varsha', gist: 'monsoon, wet and green' },      // Jul
    { name: 'Varsha', gist: 'monsoon, wet and green' },      // Aug
    { name: 'Sharad', gist: 'clear skies just after the monsoon' }, // Sep
    { name: 'Sharad', gist: 'clear skies just after the monsoon' }, // Oct
    { name: 'Hemant', gist: 'early winter, crisp mornings' }, // Nov
    { name: 'Hemant', gist: 'early winter, crisp mornings' }, // Dec
  ];
  const inIndia = (lat, lon) => lat >= 6 && lat <= 37.5 && lon >= 68 && lon <= 98;

  // Everything the UI and the prompt need to know about "now" at a place.
  function skyInfo(lat, lon, nowMs, tzOffsetMin) {
    const local = new Date(nowMs - tzOffsetMin * 60000);
    const month = local.getUTCMonth();
    const localClock = local.toISOString().slice(11, 16);
    const ritu = inIndia(lat, lon) ? RITUS[month] : null;
    const season = seasonFor(lat, month);
    const t = sunTimes(lat, lon, local.getUTCFullYear(), month, local.getUTCDate());
    const hhmm = (ms) => new Date(ms - tzOffsetMin * 60000).toISOString().slice(11, 16);

    if (t.polar) {
      const phase = t.polar === 'day' ? 'day' : 'night';
      return { phase, localClock, ritu, season, polar: t.polar, minutesLeft: phase === 'day' ? 1440 : 0,
        text: t.polar === 'day' ? 'the sun is up around the clock here right now' : 'the sun is not rising at all today' };
    }
    const min = (ms) => (ms - nowMs) / 60000;
    let phase = 'day';
    if (min(t.sunrise) > 45) phase = 'night';
    else if (min(t.sunrise) > -60) phase = 'dawn';
    else if (min(t.sunset) > 90) phase = 'day';
    else if (min(t.sunset) > 0) phase = 'golden';
    else if (min(t.sunset) > -45) phase = 'dusk';
    else phase = 'night';

    const minutesLeft = Math.max(0, Math.round(min(t.sunset)));
    let text;
    if (nowMs < t.sunrise) text = `it is before sunrise (sunrise ${hhmm(t.sunrise)}, sunset ${hhmm(t.sunset)})`;
    else if (minutesLeft <= 0) text = `the sun has already set (sunset was ${hhmm(t.sunset)}), so it is dark or dusky outside`;
    else text = `sunset is at ${hhmm(t.sunset)}, about ${minutesLeft} minutes from now${phase === 'golden' ? ', so the golden hour has begun' : ''}`;

    return { phase, localClock, ritu, season, sunrise: t.sunrise, sunset: t.sunset, minutesLeft, text };
  }

  return { sunTimes, seasonFor, RITUS, inIndia, skyInfo };
});
