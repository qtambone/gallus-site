/*
 * « Demander à un proche » : la page où un proche enregistre un réveil.
 *
 * Le secret du lien est après le # (jamais envoyé à ce site). La voix est
 * enregistrée dans le navigateur, encodée en WAV PCM 16 bits mono 22,05 kHz (un
 * format que l'iPhone lit à coup sûr, contrairement au WebM de Chrome), puis
 * envoyée à l'API Gallus qui revérifie tout.
 *
 * Tout texte venant du serveur (prénom) est posé en textContent, jamais en HTML.
 */
(function () {
  'use strict';

  var API = {
    prod: 'https://ncifazqdnwwarttxijim.supabase.co/functions/v1/voice-drop',
    preprod: 'https://bdhmuqppvcmewixservq.supabase.co/functions/v1/voice-drop',
  };
  var MAX_SECONDS = 20;
  var MIN_SECONDS = 1;
  var TARGET_RATE = 22050;
  /** -50 dBFS : en dessous, le micro n'a rien capté (même seuil que le serveur). */
  var MIN_PEAK = 104 / 32768;
  var TOKEN_PATTERN = /^[A-Za-z0-9_-]{24}$/;

  var STRINGS = {
    fr: {
      loading: 'Chargement…',
      titleWithName: '{name} te demande d’enregistrer son réveil',
      titleNoName: 'On te demande d’enregistrer un réveil',
      subtitle: 'Un message pour l’aider à se lever : un encouragement, une blague, une chanson. 20\u00a0secondes maximum.',
      nameLabel: 'Ton prénom',
      record: 'Enregistrer',
      starting: 'Préparation du micro…',
      stop: 'Arrêter',
      retry: 'Recommencer',
      send: 'Envoyer',
      sending: 'Envoi…',
      doneTitle: 'C’est envoyé !',
      doneWithName: '{name} l’entendra à son réveil.',
      doneNoName: 'Ton message sonnera à son réveil.',
      discover: 'Découvrir Gallus',
      invalidTitle: 'Ce lien ne fonctionne pas',
      invalidBody: 'Vérifie que le lien a été copié en entier, ou demande-en un nouveau.',
      usedTitle: 'Ce réveil est déjà enregistré',
      usedBody: 'Quelqu’un a déjà répondu à ce lien. Pour en enregistrer un autre, demande un nouveau lien.',
      expiredTitle: 'Ce lien a expiré',
      expiredBody: 'Les liens sont valables 7 jours. Demande-en un nouveau.',
      loadErrorTitle: 'Impossible de charger la page',
      loadErrorBody: 'Vérifie ta connexion, puis recharge la page.',
      unsupported: 'Ton navigateur ne permet pas d’enregistrer. Ouvre ce lien dans Safari ou Chrome.',
      micDenied: 'Le micro est bloqué. Autorise-le dans les réglages de ton navigateur, puis réessaie.',
      tooShort: 'C’est un peu court : enregistre au moins une seconde.',
      silent: 'On n’a rien entendu. Vérifie que ton micro n’est pas coupé, puis recommence.',
      rateLimited: 'Trop d’essais pour aujourd’hui. Réessaie demain.',
      rateLimitedTitle: 'Trop d’essais pour aujourd’hui',
      rateLimitedBody: 'Réessaie demain avec le même lien.',
      micBusy: 'Le micro est déjà utilisé par une autre app (un appel ?). Libère-le, puis réessaie.',
      full: 'Sa boîte de réveils est pleine pour l’instant. Réessaie dans quelques jours.',
      busy: 'Le service est très demandé en ce moment. Réessaie un peu plus tard.',
      sendFailed: 'L’envoi n’a pas marché. Vérifie ta connexion et réessaie.',
    },
    en: {
      loading: 'Loading…',
      titleWithName: '{name} is asking you to record their wake-up sound',
      titleNoName: 'You’re asked to record a wake-up sound',
      subtitle: 'A message to help them get up: some encouragement, a joke, a song. 20\u00a0seconds max.',
      nameLabel: 'Your first name',
      record: 'Record',
      starting: 'Starting the microphone…',
      stop: 'Stop',
      retry: 'Start over',
      send: 'Send',
      sending: 'Sending…',
      doneTitle: 'Sent!',
      doneWithName: '{name} will hear it when they wake up.',
      doneNoName: 'Your message will ring when they wake up.',
      discover: 'Discover Gallus',
      invalidTitle: 'This link doesn’t work',
      invalidBody: 'Make sure the whole link was copied, or ask for a new one.',
      usedTitle: 'This wake-up sound is already recorded',
      usedBody: 'Someone already answered this link. To record another one, ask for a new link.',
      expiredTitle: 'This link has expired',
      expiredBody: 'Links are valid for 7 days. Ask for a new one.',
      loadErrorTitle: 'Couldn’t load the page',
      loadErrorBody: 'Check your connection, then reload the page.',
      unsupported: 'Your browser can’t record. Open this link in Safari or Chrome.',
      micDenied: 'The microphone is blocked. Allow it in your browser settings, then try again.',
      tooShort: 'That’s a bit short: record at least one second.',
      silent: 'We couldn’t hear anything. Make sure your microphone isn’t muted, then start over.',
      rateLimited: 'Too many attempts today. Try again tomorrow.',
      rateLimitedTitle: 'Too many attempts today',
      rateLimitedBody: 'Try again tomorrow with the same link.',
      micBusy: 'The microphone is being used by another app (a call?). Free it up, then try again.',
      full: 'Their wake-up inbox is full for now. Try again in a few days.',
      busy: 'The service is very busy right now. Try again a bit later.',
      sendFailed: 'Sending didn’t work. Check your connection and try again.',
    },
  };

  // Jamais dans un cadre : un site tiers pourrait habiller la page (ou son lien)
  // pour faire enregistrer quelqu'un à son insu. GitHub Pages ne permet pas
  // l'en-tête frame-ancestors, d'où ce garde-fou en script.
  if (window.top !== window.self) {
    document.documentElement.hidden = true;
    return;
  }

  var lang = /^fr\b/i.test(navigator.language || '') ? 'fr' : 'en';
  var text = STRINGS[lang];
  document.documentElement.lang = lang;

  var params = new URLSearchParams(window.location.search);
  var api = params.get('env') === 'preprod' ? API.preprod : API.prod;
  var token = window.location.hash.slice(1);

  var $ = function (selector) { return document.querySelector(selector); };
  var requesterName = null;

  function fill(template, name) {
    // Fonction de remplacement : un « $ » dans le texte ne serait pas interprété.
    return template.replace('{name}', function () { return name; });
  }

  function showView(name) {
    document.querySelectorAll('[data-view]').forEach(function (section) {
      section.hidden = section.getAttribute('data-view') !== name;
    });
  }

  function showClosed(reason) {
    var keys = {
      invalid: ['invalidTitle', 'invalidBody'],
      used: ['usedTitle', 'usedBody'],
      expired: ['expiredTitle', 'expiredBody'],
      rate_limited: ['rateLimitedTitle', 'rateLimitedBody'],
      error: ['loadErrorTitle', 'loadErrorBody'],
    }[reason] || ['invalidTitle', 'invalidBody'];
    $('[data-slot="closed-title"]').textContent = text[keys[0]];
    $('[data-slot="closed-body"]').textContent = text[keys[1]];
    // Lien mort : le secret n'a plus rien à faire dans l'adresse (historique,
    // copie de l'URL). Pas pour une panne passagère : recharger doit marcher.
    if (reason !== 'error' && reason !== 'rate_limited') forgetToken();
    showView('closed');
  }

  function forgetToken() {
    try {
      history.replaceState(null, '', window.location.pathname + window.location.search);
    } catch (e) { /* adresse inchangée, sans conséquence */ }
  }

  function showError(key) {
    var error = $('#error');
    error.textContent = key ? text[key] : '';
    error.hidden = !key;
  }

  document.querySelectorAll('[data-i18n]').forEach(function (node) {
    node.textContent = text[node.getAttribute('data-i18n')];
  });

  // ─── Chargement du lien ───────────────────────────────────────────────────

  function load() {
    if (!TOKEN_PATTERN.test(token)) {
      showClosed('invalid');
      return;
    }
    fetch(api + '?action=info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token }),
    })
      .then(function (response) {
        return response.json().catch(function () { return {}; }).then(function (body) {
          return { status: response.status, body: body };
        });
      })
      .then(function (result) {
        if (result.status === 429) {
          showClosed('rate_limited');
          return;
        }
        if (result.body.status !== 'open') {
          var known = ['invalid', 'used', 'expired'].indexOf(result.body.status) >= 0;
          showClosed(known ? result.body.status : 'error');
          return;
        }
        requesterName = typeof result.body.requesterName === 'string' && result.body.requesterName
          ? result.body.requesterName
          : null;
        $('[data-slot="title"]').textContent = requesterName
          ? fill(text.titleWithName, requesterName)
          : text.titleNoName;
        showView('record');
      })
      .catch(function () {
        showClosed('error');
      });
  }

  // ─── Enregistrement ───────────────────────────────────────────────────────

  var recordButton = $('#record');
  var recordLabel = $('#record-label');
  var timer = $('#timer');
  var progress = document.querySelector('.progress');
  var progressBar = $('#progress-bar');
  var review = $('#review');
  var playback = $('#playback');

  var state = 'idle'; // idle | starting | recording | review | sending
  var session = null; // { stream, context, node, chunks, samples, rate }
  var wavBlob = null;
  var playbackUrl = null;
  var startingTimer = null;
  /** Un envoi est parti sans réponse (réseau coupé) : il a peut-être abouti. */
  var uploadMaybeDelivered = false;
  var STARTING_TIMEOUT_MS = 10000;

  function formatSeconds(seconds) {
    var s = Math.min(MAX_SECONDS, Math.floor(seconds));
    return '0:' + (s < 10 ? '0' : '') + s;
  }

  function setState(next) {
    state = next;
    if (next !== 'starting' && startingTimer) {
      clearTimeout(startingTimer);
      startingTimer = null;
    }
    recordButton.classList.toggle('recording', next === 'recording');
    recordButton.disabled = next === 'starting' || next === 'sending';
    recordButton.hidden = next === 'review' || next === 'sending';
    recordLabel.textContent = next === 'starting' ? text.starting : next === 'recording' ? text.stop : text.record;
    timer.hidden = next !== 'recording';
    progress.hidden = next !== 'recording';
    review.hidden = next !== 'review' && next !== 'sending';
    $('#send').disabled = next === 'sending';
    $('#retry').disabled = next === 'sending';
    $('#send').textContent = next === 'sending' ? text.sending : text.send;
  }

  function supported() {
    return !!(
      navigator.mediaDevices &&
      navigator.mediaDevices.getUserMedia &&
      window.AudioContext &&
      window.AudioWorkletNode &&
      window.OfflineAudioContext
    );
  }

  function releaseSession() {
    if (!session) return;
    try { session.node.port.onmessage = null; } catch (e) { /* déjà libéré */ }
    try { session.node.disconnect(); } catch (e) { /* déjà déconnecté */ }
    session.stream.getTracks().forEach(function (track) { track.stop(); });
    session.context.close().catch(function () {});
    session = null;
  }

  function startRecording() {
    showError(null);
    if (!supported()) {
      showError('unsupported');
      return;
    }
    setState('starting');
    var stream = null;
    var context = null;
    navigator.mediaDevices
      .getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      .then(function (s) {
        stream = s;
        context = new AudioContext();
        return context.audioWorklet.addModule('recorder-worklet.js');
      })
      .then(function () {
        var source = context.createMediaStreamSource(stream);
        var node = new AudioWorkletNode(context, 'gallus-recorder');
        // Un nœud non relié à la sortie n'est pas toujours traité : on le relie
        // à un gain nul (rien ne sort des haut-parleurs).
        var mute = context.createGain();
        mute.gain.value = 0;
        source.connect(node);
        node.connect(mute);
        mute.connect(context.destination);

        session = { stream: stream, context: context, node: node, chunks: [], samples: 0, rate: context.sampleRate };
        // Micro accordé mais aucun son ne remonte (contexte audio bloqué) : on
        // rend la main plutôt que de laisser « Préparation du micro… » à vie.
        var started = session;
        startingTimer = setTimeout(function () {
          if (state !== 'starting' || session !== started) return;
          releaseSession();
          setState('idle');
          showError('unsupported');
        }, STARTING_TIMEOUT_MS);
        var maxSamples = MAX_SECONDS * context.sampleRate;
        node.port.onmessage = function (event) {
          if (!session) return;
          // L'invite « enregistrement » n'apparaît qu'une fois le micro réellement
          // parti : sinon les premiers mots se perdraient.
          if (state === 'starting') setState('recording');
          session.chunks.push(event.data);
          session.samples += event.data.length;
          var seconds = session.samples / session.rate;
          timer.textContent = formatSeconds(seconds) + ' / ' + formatSeconds(MAX_SECONDS);
          progressBar.style.width = Math.min(100, (seconds / MAX_SECONDS) * 100) + '%';
          if (session.samples >= maxSamples) stopRecording();
        };
        return context.resume();
      })
      .catch(function (error) {
        if (stream) stream.getTracks().forEach(function (track) { track.stop(); });
        if (context) context.close().catch(function () {});
        session = null;
        setState('idle');
        var name = error && error.name;
        if (name === 'NotAllowedError' || name === 'SecurityError') showError('micDenied');
        else if (name === 'NotReadableError' || name === 'AbortError') showError('micBusy');
        else showError('unsupported');
      });
  }

  function mergeChunks(chunks, total) {
    var merged = new Float32Array(total);
    var offset = 0;
    chunks.forEach(function (chunk) {
      if (offset >= total) return;
      var count = Math.min(chunk.length, total - offset);
      merged.set(chunk.subarray(0, count), offset);
      offset += count;
    });
    return merged;
  }

  /** Rééchantillonne à 22,05 kHz et encode en WAV PCM 16 bits mono. */
  function encodeWav(samples, rate) {
    var outLength = Math.max(1, Math.round(samples.length * TARGET_RATE / rate));
    var offline = new OfflineAudioContext(1, outLength, TARGET_RATE);
    var buffer = offline.createBuffer(1, samples.length, rate);
    buffer.getChannelData(0).set(samples);
    var source = offline.createBufferSource();
    source.buffer = buffer;
    source.connect(offline.destination);
    source.start();
    return offline.startRendering().then(function (rendered) {
      var data = rendered.getChannelData(0);
      var bytes = new ArrayBuffer(44 + data.length * 2);
      var view = new DataView(bytes);
      var writeAscii = function (offset, value) {
        for (var i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
      };
      writeAscii(0, 'RIFF');
      view.setUint32(4, 36 + data.length * 2, true);
      writeAscii(8, 'WAVE');
      writeAscii(12, 'fmt ');
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 1, true);
      view.setUint32(24, TARGET_RATE, true);
      view.setUint32(28, TARGET_RATE * 2, true);
      view.setUint16(32, 2, true);
      view.setUint16(34, 16, true);
      writeAscii(36, 'data');
      view.setUint32(40, data.length * 2, true);
      var peak = 0;
      for (var i = 0; i < data.length; i++) {
        var sample = Math.max(-1, Math.min(1, data[i]));
        peak = Math.max(peak, Math.abs(sample));
        view.setInt16(44 + i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      }
      return { blob: new Blob([bytes], { type: 'audio/wav' }), seconds: data.length / TARGET_RATE, peak: peak };
    });
  }

  function stopRecording() {
    if (state !== 'recording' || !session) return;
    var current = session;
    var total = Math.min(current.samples, MAX_SECONDS * current.rate);
    var samples = mergeChunks(current.chunks, total);
    var rate = current.rate;
    releaseSession();
    setState('starting');
    recordLabel.textContent = text.record;

    encodeWav(samples, rate)
      .then(function (result) {
        if (result.seconds < MIN_SECONDS) {
          setState('idle');
          showError('tooShort');
          return;
        }
        if (result.peak < MIN_PEAK) {
          setState('idle');
          showError('silent');
          return;
        }
        wavBlob = result.blob;
        if (playbackUrl) URL.revokeObjectURL(playbackUrl);
        playbackUrl = URL.createObjectURL(wavBlob);
        playback.src = playbackUrl;
        setState('review');
      })
      .catch(function () {
        setState('idle');
        showError('unsupported');
      });
  }

  function retry() {
    playback.pause();
    playback.removeAttribute('src');
    if (playbackUrl) URL.revokeObjectURL(playbackUrl);
    playbackUrl = null;
    wavBlob = null;
    showError(null);
    setState('idle');
  }

  // ─── Envoi ────────────────────────────────────────────────────────────────

  function send() {
    if (!wavBlob || state !== 'review') return;
    playback.pause();
    showError(null);
    setState('sending');

    var headers = { 'Content-Type': 'audio/wav', 'x-voice-token': token };
    var name = senderName();
    if (name) headers['x-sender-name'] = encodeURIComponent(name);

    fetch(api + '?action=upload', { method: 'POST', headers: headers, body: wavBlob })
      .then(function (response) {
        return response.json().catch(function () { return {}; }).then(function (body) {
          return { status: response.status, body: body };
        });
      })
      .then(function (result) {
        var error = result.body.error;
        // Réponse d'un premier envoi perdue, lien « déjà utilisé » au second :
        // c'est ce premier envoi qui a abouti.
        if ((result.status === 200 && result.body.ok) || (error === 'used' && uploadMaybeDelivered)) {
          $('[data-slot="done-body"]').textContent = requesterName
            ? fill(text.doneWithName, requesterName)
            : text.doneNoName;
          retry();
          forgetToken();
          showView('done');
          return;
        }
        if (error === 'used' || error === 'expired' || error === 'invalid') {
          showClosed(error);
          return;
        }
        setState('review');
        if (error === 'silent') showError('silent');
        else if (error === 'too_short') showError('tooShort');
        else if (error === 'full') showError('full');
        else if (error === 'busy') showError('busy');
        else if (result.status === 429) showError('rateLimited');
        else showError('sendFailed');
      })
      .catch(function () {
        uploadMaybeDelivered = true;
        setState('review');
        showError('sendFailed');
      });
  }

  /** Prénom saisi : 30 caractères au plus sans couper un emoji, sans demi-caractère. */
  function senderName() {
    return Array.from($('#sender-name').value.trim())
      .filter(function (c) { return !(c.length === 1 && c >= '\uD800' && c <= '\uDFFF'); })
      .slice(0, 30)
      .join('')
      .trim();
  }

  recordButton.addEventListener('click', function () {
    if (state === 'idle') startRecording();
    else if (state === 'recording') stopRecording();
  });
  $('#retry').addEventListener('click', retry);
  $('#send').addEventListener('click', send);

  // Page quittée ou mise en arrière-plan : le micro est rendu, et la page revient
  // (cache avant/arrière de Safari) prête à réenregistrer.
  window.addEventListener('pagehide', function () {
    releaseSession();
    if (state === 'starting' || state === 'recording') setState('idle');
  });

  setState('idle');
  load();
})();
