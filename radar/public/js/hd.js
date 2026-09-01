// ─────────────────────────────────────────────────────────────
// hd.js - Millora visual "SUPER HD" per Tempestes.cat
// Mòdul independent: sharpening (unsharp mask) sobre canvas.
// No coneix res de fetch/msgpack/leaflet — només rep un canvas
// i el retorna millorat. S'integra a mapasatelit.js cridant
// HDEnhance.sharpen(ctx, width, height, opts) just abans de
// fer .toDataURL().
// ─────────────────────────────────────────────────────────────

(function (global) {
  'use strict';

  // Kernel gaussià 3x3 per generar la versió "blurred" de referència
  var BLUR_KERNEL = [1, 2, 1, 2, 4, 2, 1, 2, 1];
  var BLUR_KERNEL_SUM = 16;

  // Kernel de convolució de sharpening directe (Laplacian-based).
  // Més agressiu que l'unsharp mask: afecta cada píxel directament
  // en comptes de comparar amb una versió difuminada.
  function applyConvolutionSharpen(src, width, height, strength) {
    // strength ~0 = sense efecte, ~1 = sharpen estàndard, >1 = molt fort
    var s = strength;
    var kernel = [
      0, -s, 0,
      -s, 1 + 4 * s, -s,
      0, -s, 0
    ];
    var out = new Uint8ClampedArray(src.length);

    for (var y = 0; y < height; y++) {
      for (var x = 0; x < width; x++) {
        var outIdx = (y * width + x) * 4;
        for (var c = 0; c < 3; c++) {
          var sum = 0;
          var ki = 0;
          for (var dy = -1; dy <= 1; dy++) {
            for (var dx = -1; dx <= 1; dx++) {
              var w = kernel[ki++];
              if (w === 0) continue;
              var sx = Math.min(width - 1, Math.max(0, x + dx));
              var sy = Math.min(height - 1, Math.max(0, y + dy));
              sum += src[(sy * width + sx) * 4 + c] * w;
            }
          }
          out[outIdx + c] = sum;
        }
        out[outIdx + 3] = src[outIdx + 3];
      }
    }
    return out;
  }

  /**
   * Genera una còpia blurred (3x3 gaussià) del canvas per fer servir
   * com a base de comparació de l'unsharp mask.
   */
  function computeBlurred(src, width, height) {
    var blurred = new Uint8ClampedArray(src.length);

    for (var y = 0; y < height; y++) {
      for (var x = 0; x < width; x++) {
        var r = 0, g = 0, b = 0;
        var ki = 0;
        for (var dy = -1; dy <= 1; dy++) {
          for (var dx = -1; dx <= 1; dx++) {
            var sx = Math.min(width - 1, Math.max(0, x + dx));
            var sy = Math.min(height - 1, Math.max(0, y + dy));
            var idx = (sy * width + sx) * 4;
            var w = BLUR_KERNEL[ki++];
            r += src[idx] * w;
            g += src[idx + 1] * w;
            b += src[idx + 2] * w;
          }
        }
        var outIdx = (y * width + x) * 4;
        blurred[outIdx] = r / BLUR_KERNEL_SUM;
        blurred[outIdx + 1] = g / BLUR_KERNEL_SUM;
        blurred[outIdx + 2] = b / BLUR_KERNEL_SUM;
        blurred[outIdx + 3] = src[outIdx + 3];
      }
    }
    return blurred;
  }

  /**
   * Unsharp mask: original + amount * (original - blurred)
   * Només actua si la diferència supera el threshold (evita amplificar soroll pla).
   */
  function unsharpMask(src, width, height, amount, threshold) {
    var blurred = computeBlurred(src, width, height);
    var out = new Uint8ClampedArray(src.length);

    for (var i = 0; i < src.length; i += 4) {
      for (var c = 0; c < 3; c++) {
        var diff = src[i + c] - blurred[i + c];
        out[i + c] = Math.abs(diff) < threshold
          ? src[i + c]
          : src[i + c] + diff * amount;
      }
      out[i + 3] = src[i + 3]; // alpha intacte
    }
    return out;
  }

  /**
   * Aplica sharpening a un canvas 2D context existent (in-place).
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} width
   * @param {number} height
   * @param {Object} [opts]
   * @param {number} [opts.amount=0.8]     Intensitat del sharpen (0.4 subtil, 1.2 fort)
   * @param {number} [opts.threshold=2]    Diferència mínima (0-255) per actuar; evita soroll
   */
  function sharpen(ctx, width, height, opts) {
    opts = opts || {};
    var amount = opts.amount !== undefined ? opts.amount : 0.8;
    var threshold = opts.threshold !== undefined ? opts.threshold : 2;
    var mode = opts.mode || 'unsharp'; // 'unsharp' | 'convolution'
    var strength = opts.strength !== undefined ? opts.strength : 0.5;

    var imageData = ctx.getImageData(0, 0, width, height);
    var result;

    if (mode === 'convolution') {
      result = applyConvolutionSharpen(imageData.data, width, height, strength);
    } else {
      result = unsharpMask(imageData.data, width, height, amount, threshold);
    }

    ctx.putImageData(new ImageData(result, width, height), 0, 0);
  }

  /**
   * Helper d'alt nivell: donat un canvas font petit, el reescala en
   * dues passades (com fa mapasatelit.js) i aplica sharpening entre
   * passades (sobre el canvas intermedi, que és més barat de processar
   * i el detall no es perd en el 2n escalat).
   *
   * @param {HTMLCanvasElement} sourceCanvas
   * @param {number} finalScale   Factor d'escalat total (p.ex. 4)
   * @param {Object} [opts]       { amount, threshold, cssFilter }
   * @returns {HTMLCanvasElement} canvas final ja escalat i afinat
   */
  function upscaleWithSharpen(sourceCanvas, finalScale, opts) {
    opts = opts || {};
    var midFactor = Math.max(1, Math.round(finalScale / 2));

    // Passada 1: escalat intermedi
    var mid = document.createElement('canvas');
    mid.width = sourceCanvas.width * midFactor;
    mid.height = sourceCanvas.height * midFactor;
    var midCtx = mid.getContext('2d');
    midCtx.imageSmoothingEnabled = true;
    midCtx.imageSmoothingQuality = 'high';
    midCtx.drawImage(sourceCanvas, 0, 0, mid.width, mid.height);

    // Sharpen #1 (canvas petit -> barat) abans del 2n escalat
    sharpen(midCtx, mid.width, mid.height, {
      mode: opts.mode || 'convolution',
      strength: opts.midStrength !== undefined ? opts.midStrength : 0.6,
      amount: opts.amount !== undefined ? opts.amount : 1.2,
      threshold: opts.threshold !== undefined ? opts.threshold : 1,
    });

    // Passada 2: escalat final
    var final = document.createElement('canvas');
    final.width = sourceCanvas.width * finalScale;
    final.height = sourceCanvas.height * finalScale;
    var finalCtx = final.getContext('2d');
    finalCtx.imageSmoothingEnabled = true;
    finalCtx.imageSmoothingQuality = 'high';
    if (opts.cssFilter) finalCtx.filter = opts.cssFilter;
    finalCtx.drawImage(mid, 0, 0, final.width, final.height);
    finalCtx.filter = 'none';

    // Sharpen #2 (opcional, sobre el canvas final -> reforça vores
    // que el 2n escalat ha tornat a suavitzar una mica)
    if (opts.finalSharpen !== false) {
      sharpen(finalCtx, final.width, final.height, {
        mode: 'unsharp',
        amount: opts.finalAmount !== undefined ? opts.finalAmount : 0.7,
        threshold: opts.finalThreshold !== undefined ? opts.finalThreshold : 2,
      });
    }

    // Neteja memòria del canvas intermedi
    mid.width = 0;
    mid.height = 0;

    return final;
  }

  global.HDEnhance = {
    sharpen: sharpen,
    upscaleWithSharpen: upscaleWithSharpen,
  };

})(window);