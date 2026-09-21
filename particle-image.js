/**
 * ParticleImage - 粒子图像效果组件
 * 将图片转换为由粒子组成的交互式效果，鼠标移动时粒子会飘散并回归
 * 
 * 使用方式:
 *   const pi = new ParticleImage(container, {
 *     image: 'path/to/image.jpg',
 *     particleCount: 20000,
 *     // ... 更多配置
 *   });
 *   pi.init().then(() => console.log('ready'));
 * 
 * @author Trae Work
 */
(function(global) {
  'use strict';

  // ============================================
  // Simplex Noise 2D + Curl Noise
  // ============================================
  const SimplexNoise = (function() {
    const grad3 = [
      [1,1,0],[-1,1,0],[1,-1,0],[-1,-1,0],
      [1,0,1],[-1,0,1],[1,0,-1],[-1,0,-1],
      [0,1,1],[0,-1,1],[0,1,-1],[0,-1,-1]
    ];
    
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      const tmp = p[i]; p[i] = p[j]; p[j] = tmp;
    }
    const perm = new Uint8Array(512);
    for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
    const permMod12 = new Uint8Array(512);
    for (let i = 0; i < 512; i++) permMod12[i] = perm[i] % 12;
    
    const F2 = 0.5 * (Math.sqrt(3) - 1);
    const G2 = (3 - Math.sqrt(3)) / 6;
    
    function noise2D(xin, yin) {
      let n0 = 0, n1 = 0, n2 = 0;
      const s = (xin + yin) * F2;
      const i = (xin + s) | 0;
      const j = (yin + s) | 0;
      const t = (i + j) * G2;
      const X0 = i - t, Y0 = j - t;
      const x0 = xin - X0, y0 = yin - Y0;
      
      let i1, j1;
      if (x0 > y0) { i1 = 1; j1 = 0; }
      else { i1 = 0; j1 = 1; }
      
      const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
      const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
      
      const ii = i & 255, jj = j & 255;
      const gi0 = permMod12[ii + perm[jj]];
      const gi1 = permMod12[ii + i1 + perm[jj + j1]];
      const gi2 = permMod12[ii + 1 + perm[jj + 1]];
      
      let t0 = 0.5 - x0*x0 - y0*y0;
      if (t0 >= 0) { t0 *= t0; n0 = t0 * t0 * (grad3[gi0][0]*x0 + grad3[gi0][1]*y0); }
      
      let t1 = 0.5 - x1*x1 - y1*y1;
      if (t1 >= 0) { t1 *= t1; n1 = t1 * t1 * (grad3[gi1][0]*x1 + grad3[gi1][1]*y1); }
      
      let t2 = 0.5 - x2*x2 - y2*y2;
      if (t2 >= 0) { t2 *= t2; n2 = t2 * t2 * (grad3[gi2][0]*x2 + grad3[gi2][1]*y2); }
      
      return 70.0 * (n0 + n1 + n2);
    }
    
    function curlNoise(x, y, t) {
      const eps = 0.001;
      const n1 = noise2D(x, y + eps + t);
      const n2 = noise2D(x, y - eps + t);
      const n3 = noise2D(x + eps, y + t);
      const n4 = noise2D(x - eps, y + t);
      return {
        x: (n1 - n2) / (2 * eps),
        y: -(n3 - n4) / (2 * eps)
      };
    }
    
    return { noise2D, curlNoise };
  })();

  // ============================================
  // ParticleImage Class
  // ============================================
  class ParticleImage {
    /**
     * @param {HTMLElement} container - 容器元素
     * @param {Object} options - 配置选项
     */
    constructor(container, options = {}) {
      this.container = typeof container === 'string' 
        ? document.querySelector(container) 
        : container;
      
      if (!this.container) {
        throw new Error('ParticleImage: container not found');
      }

      // 默认配置
      this.options = Object.assign({
        // 图片
        image: null,           // 图片 URL 或 base64 (必填)
        
        // 粒子
        particleCount: 20000,  // 粒子数量
        particleSize: 1.5,     // 粒子大小 (px)
        particleOpacity: 0.85, // 粒子透明度
        minBrightness: 8,      // 最小亮度阈值 (0-255)
        minAlpha: 15,          // 最小透明度阈值 (0-255)
        
        // 流场
        noiseStrength: 0.4,    // 流场强度
        noiseScale: 0.0012,    // 流场缩放 (越小尺度越大)
        flowSpeed: 1.0,        // 流场演变速度
        
        // 物理
        springForce: 0.02,     // 回归弹力
        damping: 0.95,         // 阻尼系数
        
        // 鼠标交互
        cursorStrength: 2.5,   // 鼠标作用力强度
        cursorRadius: 130,     // 鼠标影响半径 (px)
        cursorRepel: 2.0,      // 排斥力系数
        cursorSwirl: 0.7,      // 漩涡力系数
        cursorVelocity: 0.12,  // 速度传递系数
        trailLength: 8,        // 鼠标拖尾长度
        
        // 视觉
        imageOpacity: 0.2,     // 底层原图透明度
        backgroundColor: '#000', // 背景色
        additiveBlend: true,   // 加性混合 (发光效果)
        motionStreaks: true,   // 运动拖尾
        grayscale: false,      // 灰度模式：粒子颜色转为灰度
        grayscaleRange: [20, 220], // 灰度色阶范围 [最暗, 最亮]
        invert: false,         // 反转颜色（适合浅色背景）
        imageAlign: 'center',  // 图片对齐方式: 'left' | 'center' | 'right'
        imageScale: 1,         // 图片缩放因子 (1=满铺画布, 0.85=缩小至85%)
        imagePosX: null,       // 图片水平位置 0=最左, 0.5=居中, 1=最右; null=用 imageAlign

        // 性能
        dpr: null,             // 设备像素比 (null=自动)
        maxFps: null,          // 最大帧率 (null=不限)

        // 画布比例
        canvasRatio: null,     // 画布比例 [宽, 高]，如 [1,1]=1:1, [16,9]=16:9；null=填满容器
      }, options);

      // 内部状态
      this.canvas = null;
      this.ctx = null;
      this.width = 0;
      this.height = 0;
      this.dpr = 1;
      
      this.sourceImage = null;
      this.imageLoaded = false;
      this.imgDrawW = 0;
      this.imgDrawH = 0;
      this.offsetX = 0;
      this.offsetY = 0;
      this.scale = 1;
      
      this.particleNum = 0;
      this.px = null;
      this.py = null;
      this.pvx = null;
      this.pvy = null;
      this.pox = null;
      this.poy = null;
      this.pr = null;
      this.pg = null;
      this.pb = null;
      this.psize = null;
      this.page = null;
      this.plife = null;
      
      this.mouse = {
        x: -9999, y: -9999,
        px: -9999, py: -9999,
        vx: 0, vy: 0,
        active: false
      };
      this.mouseTrail = [];
      
      this.time = 0;
      this.lastTime = 0;
      this.rafId = null;
      this.running = false;
      
      this._onResize = this._onResize.bind(this);
      this._onMouseMove = this._onMouseMove.bind(this);
      this._onMouseLeave = this._onMouseLeave.bind(this);
      this._onTouchMove = this._onTouchMove.bind(this);
      this._onTouchEnd = this._onTouchEnd.bind(this);
      this._loop = this._loop.bind(this);
    }

    /**
     * 初始化并加载图片
     * @returns {Promise<ParticleImage>}
     */
    init() {
      return new Promise((resolve, reject) => {
        // 创建 canvas
        this.canvas = document.createElement('canvas');
        this.canvas.style.display = 'block';
        this.canvas.style.cursor = 'none';
        if (getComputedStyle(this.container).position === 'static') {
          this.container.style.position = 'relative';
        }
        this.container.appendChild(this.canvas);
        // 透明背景需要 alpha 通道，否则性能更好
        const useAlpha = this.options.backgroundColor === 'transparent';
        this.ctx = this.canvas.getContext('2d', { alpha: useAlpha });
        
        // 尺寸
        this._resize();
        
        // 事件
        window.addEventListener('resize', this._onResize);
        this.canvas.addEventListener('mousemove', this._onMouseMove);
        this.canvas.addEventListener('mouseleave', this._onMouseLeave);
        this.canvas.addEventListener('touchmove', this._onTouchMove, { passive: false });
        this.canvas.addEventListener('touchend', this._onTouchEnd);
        
        // 加载图片
        if (!this.options.image) {
          reject(new Error('ParticleImage: image option is required'));
          return;
        }
        
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          this.sourceImage = img;
          this._recalcImageFit();
          this._createParticles();
          this.start();
          resolve(this);
        };
        img.onerror = () => {
          reject(new Error('ParticleImage: failed to load image: ' + this.options.image));
        };
        img.src = this.options.image;
      });
    }

    /**
     * 启动动画
     */
    start() {
      if (this.running) return;
      this.running = true;
      this.lastTime = performance.now();
      this.rafId = requestAnimationFrame(this._loop);
    }

    /**
     * 暂停动画
     */
    stop() {
      this.running = false;
      if (this.rafId) {
        cancelAnimationFrame(this.rafId);
        this.rafId = null;
      }
    }

    /**
     * 重置粒子到初始位置
     */
    reset() {
      if (this.imageLoaded) {
        this._createParticles();
      }
    }

    /**
     * 更换图片
     * @param {string} imageSrc - 新图片 URL 或 base64
     * @returns {Promise<void>}
     */
    setImage(imageSrc) {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          this.sourceImage = img;
          this.options.image = imageSrc;
          this._recalcImageFit();
          this._createParticles();
          resolve();
        };
        img.onerror = () => {
          reject(new Error('ParticleImage: failed to load image'));
        };
        img.src = imageSrc;
      });
    }

    /**
     * 更新配置（可实时更新的参数）
     * @param {Object} newOptions
     */
    setOptions(newOptions) {
      Object.assign(this.options, newOptions);
      
      // 粒子大小需要即时更新
      if (newOptions.particleSize !== undefined && this.psize) {
        const oldSize = this.options.particleSize;
        for (let i = 0; i < this.particleNum; i++) {
          const ratio = this.psize[i] / oldSize;
          this.psize[i] = newOptions.particleSize * (0.7 + (ratio - 0.7));
        }
      }
      
      // 粒子数量需要重建
      if (newOptions.particleCount !== undefined && this.imageLoaded) {
        this._createParticles();
      }

      // 画布比例变更需要重新计算尺寸和粒子位置
      if (newOptions.canvasRatio !== undefined && this.canvas) {
        this._resize();
        if (this.imageLoaded) {
          this._recalcImageFit();
          this._createParticles();
        }
      }
    }

    /**
     * 销毁实例，释放资源
     */
    destroy() {
      this.stop();
      window.removeEventListener('resize', this._onResize);
      this.canvas.removeEventListener('mousemove', this._onMouseMove);
      this.canvas.removeEventListener('mouseleave', this._onMouseLeave);
      this.canvas.removeEventListener('touchmove', this._onTouchMove);
      this.canvas.removeEventListener('touchend', this._onTouchEnd);
      if (this.canvas.parentNode) {
        this.canvas.parentNode.removeChild(this.canvas);
      }
      this.canvas = null;
      this.ctx = null;
      this.sourceImage = null;
      this.px = this.py = this.pvx = this.pvy = null;
      this.pox = this.poy = this.pr = this.pg = this.pb = null;
      this.psize = this.page = this.plife = null;
    }

    // ============================================
    // Private Methods
    // ============================================

    _onResize() {
      this._resize();
      if (this.imageLoaded) {
        this._recalcImageFit();
        this._createParticles();
      }
    }

    _resize() {
      const rect = this.container.getBoundingClientRect();
      const containerW = rect.width;
      const containerH = rect.height;

      if (this.options.canvasRatio) {
        const ratio = this.options.canvasRatio[0] / this.options.canvasRatio[1];
        const containerRatio = containerW / containerH;
        if (ratio > containerRatio) {
          this.width = containerW;
          this.height = containerW / ratio;
        } else {
          this.height = containerH;
          this.width = containerH * ratio;
        }
        this.canvas.style.width = this.width + 'px';
        this.canvas.style.height = this.height + 'px';
        this.canvas.style.position = 'absolute';
        this.canvas.style.left = '50%';
        this.canvas.style.top = '50%';
        this.canvas.style.transform = 'translate(-50%, -50%)';
      } else {
        this.width = containerW;
        this.height = containerH;
        this.canvas.style.width = '100%';
        this.canvas.style.height = '100%';
        this.canvas.style.position = 'static';
        this.canvas.style.left = '';
        this.canvas.style.top = '';
        this.canvas.style.transform = '';
      }

      this.dpr = this.options.dpr || Math.min(window.devicePixelRatio || 1, 2);
      this.canvas.width = this.width * this.dpr;
      this.canvas.height = this.height * this.dpr;
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }

    _recalcImageFit() {
      if (!this.sourceImage) return;
      const imgRatio = this.sourceImage.width / this.sourceImage.height;
      const canvasRatio = this.width / this.height;

      if (imgRatio > canvasRatio) {
        this.scale = this.width / this.sourceImage.width;
      } else {
        this.scale = this.height / this.sourceImage.height;
      }

      this.scale *= (this.options.imageScale || 1);

      this.imgDrawW = this.sourceImage.width * this.scale;
      this.imgDrawH = this.sourceImage.height * this.scale;
      const align = this.options.imageAlign || 'center';
      if (align === 'left') {
        this.offsetX = 0;
      } else if (align === 'right') {
        this.offsetX = this.width - this.imgDrawW;
      } else {
        this.offsetX = (this.width - this.imgDrawW) / 2;
      }
      if (this.options.imagePosX != null) {
        this.offsetX = this.options.imagePosX * (this.width - this.imgDrawW);
      }
      this.offsetY = (this.height - this.imgDrawH) / 2;
    }

    _createParticles() {
      if (!this.sourceImage) return;
      
      const offCanvas = document.createElement('canvas');
      const offCtx = offCanvas.getContext('2d');
      
      const targetCount = this.options.particleCount;
      const imgArea = this.sourceImage.width * this.sourceImage.height;
      const sampleRatio = Math.sqrt(targetCount / imgArea) * 1.5;
      const sampleW = Math.max(50, Math.floor(this.sourceImage.width * sampleRatio));
      const sampleH = Math.max(50, Math.floor(this.sourceImage.height * sampleRatio));
      
      offCanvas.width = sampleW;
      offCanvas.height = sampleH;
      offCtx.drawImage(this.sourceImage, 0, 0, sampleW, sampleH);
      
      const imgData = offCtx.getImageData(0, 0, sampleW, sampleH);
      const data = imgData.data;
      
      const positions = [];
      const colors = [];
      
      for (let y = 0; y < sampleH; y++) {
        for (let x = 0; x < sampleW; x++) {
          const idx = (y * sampleW + x) * 4;
          const r = data[idx];
          const g = data[idx + 1];
          const b = data[idx + 2];
          const a = data[idx + 3];
          const brightness = (r + g + b) / 3;
          
          if (a > this.options.minAlpha && brightness > this.options.minBrightness) {
            positions.push({ x: x / sampleRatio, y: y / sampleRatio });
            colors.push({ r, g, b });
          }
        }
      }
      
      const actualCount = Math.min(targetCount, positions.length);
      
      if (positions.length > actualCount) {
        for (let i = positions.length - 1; i > 0; i--) {
          const j = (Math.random() * (i + 1)) | 0;
          [positions[i], positions[j]] = [positions[j], positions[i]];
          [colors[i], colors[j]] = [colors[j], colors[i]];
        }
      }
      
      this.particleNum = actualCount;
      this.px = new Float32Array(actualCount);
      this.py = new Float32Array(actualCount);
      this.pvx = new Float32Array(actualCount);
      this.pvy = new Float32Array(actualCount);
      this.pox = new Float32Array(actualCount);
      this.poy = new Float32Array(actualCount);
      this.pr = new Uint8Array(actualCount);
      this.pg = new Uint8Array(actualCount);
      this.pb = new Uint8Array(actualCount);
      this.psize = new Float32Array(actualCount);
      this.page = new Float32Array(actualCount);
      this.plife = new Float32Array(actualCount);
      
      for (let i = 0; i < actualCount; i++) {
        const screenX = this.offsetX + positions[i].x * this.scale;
        const screenY = this.offsetY + positions[i].y * this.scale;
        
        this.px[i] = screenX;
        this.py[i] = screenY;
        this.pox[i] = screenX;
        this.poy[i] = screenY;
        this.pvx[i] = (Math.random() - 0.5) * 0.5;
        this.pvy[i] = (Math.random() - 0.5) * 0.5;
        let r = colors[i].r;
        let g = colors[i].g;
        let b = colors[i].b;
        
        // 灰度模式
        if (this.options.grayscale) {
          const gray = 0.299 * r + 0.587 * g + 0.114 * b;
          const [minGray, maxGray] = this.options.grayscaleRange;
          const mapped = minGray + (gray / 255) * (maxGray - minGray);
          r = g = b = Math.round(mapped);
        }
        
        // 反转颜色
        if (this.options.invert) {
          r = 255 - r;
          g = 255 - g;
          b = 255 - b;
        }
        
        this.pr[i] = r;
        this.pg[i] = g;
        this.pb[i] = b;
        this.psize[i] = this.options.particleSize * (0.7 + Math.random() * 0.6);
        this.page[i] = Math.random() * 250;
        this.plife[i] = 200 + Math.random() * 150;
      }
      
      this.imageLoaded = true;
    }

    _onMouseMove(e) {
      const rect = this.canvas.getBoundingClientRect();
      this.mouse.px = this.mouse.x;
      this.mouse.py = this.mouse.y;
      this.mouse.x = e.clientX - rect.left;
      this.mouse.y = e.clientY - rect.top;
      this.mouse.vx = this.mouse.x - this.mouse.px;
      this.mouse.vy = this.mouse.y - this.mouse.py;
      this.mouse.active = true;
    }

    _onMouseLeave() {
      this.mouse.active = false;
      this.mouse.x = -9999;
      this.mouse.y = -9999;
    }

    _onTouchMove(e) {
      e.preventDefault();
      const touch = e.touches[0];
      const rect = this.canvas.getBoundingClientRect();
      this.mouse.px = this.mouse.x;
      this.mouse.py = this.mouse.y;
      this.mouse.x = touch.clientX - rect.left;
      this.mouse.y = touch.clientY - rect.top;
      this.mouse.vx = this.mouse.x - this.mouse.px;
      this.mouse.vy = this.mouse.y - this.mouse.py;
      this.mouse.active = true;
    }

    _onTouchEnd() {
      this.mouse.active = false;
      this.mouse.x = -9999;
      this.mouse.y = -9999;
    }

    _updateMouseTrail() {
      if (this.mouse.active && this.mouse.x > -9000) {
        this.mouseTrail.unshift({
          x: this.mouse.x,
          y: this.mouse.y,
          vx: this.mouse.vx,
          vy: this.mouse.vy
        });
        if (this.mouseTrail.length > this.options.trailLength) {
          this.mouseTrail.pop();
        }
      } else if (this.mouseTrail.length > 0) {
        this.mouseTrail.pop();
      }
      this.mouse.vx *= 0.9;
      this.mouse.vy *= 0.9;
    }

    _updateParticles(dt) {
      this.time += 0.003 * this.options.flowSpeed * dt;
      
      const {
        noiseScale, noiseStrength,
        springForce, damping,
        cursorStrength, cursorRadius,
        cursorRepel, cursorSwirl, cursorVelocity,
        trailLength
      } = this.options;
      
      this._updateMouseTrail();
      
      const trail = this.mouseTrail;
      const num = this.particleNum;
      const px = this.px, py = this.py;
      const pvx = this.pvx, pvy = this.pvy;
      const pox = this.pox, poy = this.poy;
      const page = this.page, plife = this.plife;
      
      for (let i = 0; i < num; i++) {
        let vx = pvx[i];
        let vy = pvy[i];
        const x = px[i];
        const y = py[i];
        const ox = pox[i];
        const oy = poy[i];
        
        // 1. Curl noise flow field
        const curl = SimplexNoise.curlNoise(x * noiseScale, y * noiseScale, this.time);
        vx += curl.x * noiseStrength * 0.1 * dt;
        vy += curl.y * noiseStrength * 0.1 * dt;
        
        // 2. Secondary noise layer
        const n = SimplexNoise.noise2D(
          x * noiseScale * 3 + this.time * 2,
          y * noiseScale * 3 - this.time * 1.5
        );
        vx += Math.cos(n * Math.PI * 2) * noiseStrength * 0.05 * dt;
        vy += Math.sin(n * Math.PI * 2) * noiseStrength * 0.05 * dt;
        
        // 3. Spring force back to origin
        vx += (ox - x) * springForce * dt;
        vy += (oy - y) * springForce * dt;
        
        // 4. Mouse interaction with trail
        if (cursorStrength > 0 && trail.length > 0) {
          for (let t = 0; t < trail.length; t++) {
            const mt = trail[t];
            const dx = x - mt.x;
            const dy = y - mt.y;
            const distSq = dx * dx + dy * dy;
            const trailRadius = cursorRadius * (1 - t / trailLength * 0.4);
            const trailRadiusSq = trailRadius * trailRadius;
            
            if (distSq < trailRadiusSq) {
              const dist = Math.sqrt(distSq) + 0.001;
              const falloff = 1 - dist / trailRadius;
              const falloffSq = falloff * falloff;
              const trailStrength = cursorStrength * (1 - t / trailLength);
              
              // Repulsion
              const repel = falloffSq * trailStrength * cursorRepel * dt;
              vx += (dx / dist) * repel;
              vy += (dy / dist) * repel;
              
              // Swirl
              const swirl = falloffSq * trailStrength * cursorSwirl * dt;
              vx += (-dy / dist) * swirl;
              vy += (dx / dist) * swirl;
              
              // Velocity transfer
              vx += mt.vx * falloff * trailStrength * cursorVelocity * dt;
              vy += mt.vy * falloff * trailStrength * cursorVelocity * dt;
            }
          }
        }
        
        // 5. Damping
        vx *= damping;
        vy *= damping;
        
        // 6. Update position
        px[i] = x + vx * dt;
        py[i] = y + vy * dt;
        pvx[i] = vx;
        pvy[i] = vy;
        
        // 7. Lifecycle
        page[i] += dt;
        if (page[i] > plife[i]) {
          const angle = Math.random() * Math.PI * 2;
          const r = Math.random() * 12;
          px[i] = ox + Math.cos(angle) * r;
          py[i] = oy + Math.sin(angle) * r;
          pvx[i] *= 0.3;
          pvy[i] *= 0.3;
          page[i] = 0;
          plife[i] = 200 + Math.random() * 150;
        }
      }
    }

    _render() {
      const ctx = this.ctx;
      const w = this.width;
      const h = this.height;
      const opts = this.options;
      
      // Background
      if (opts.backgroundColor === 'transparent') {
        ctx.clearRect(0, 0, w, h);
      } else {
        ctx.fillStyle = opts.backgroundColor;
        ctx.fillRect(0, 0, w, h);
      }
      
      if (!this.imageLoaded || this.particleNum === 0) return;
      
      // Background image
      if (opts.imageOpacity > 0 && this.sourceImage) {
        ctx.globalAlpha = opts.imageOpacity;
        ctx.drawImage(this.sourceImage, this.offsetX, this.offsetY, this.imgDrawW, this.imgDrawH);
        ctx.globalAlpha = 1;
      }
      
      // Particles
      if (opts.additiveBlend) {
        ctx.globalCompositeOperation = 'lighter';
      }
      ctx.globalAlpha = opts.particleOpacity;
      
      const num = this.particleNum;
      const px = this.px, py = this.py;
      const pvx = this.pvx, pvy = this.pvy;
      const pr = this.pr, pg = this.pg, pb = this.pb;
      const psize = this.psize;
      const page = this.page, plife = this.plife;
      
      for (let i = 0; i < num; i++) {
        const x = px[i];
        const y = py[i];
        const s = psize[i];
        
        const ageRatio = page[i] / plife[i];
        let alpha;
        if (ageRatio < 0.15) {
          alpha = ageRatio / 0.15;
        } else if (ageRatio > 0.85) {
          alpha = (1 - ageRatio) / 0.15;
        } else {
          alpha = 1;
        }
        
        if (alpha <= 0) continue;
        
        const speed = Math.sqrt(pvx[i]*pvx[i] + pvy[i]*pvy[i]);
        
        if (opts.motionStreaks && speed > 2) {
          const streakLen = Math.min(speed * 0.6, 10);
          const nx = pvx[i] / (speed + 0.001);
          const ny = pvy[i] / (speed + 0.001);
          const x1 = x - nx * streakLen * 0.5;
          const y1 = y - ny * streakLen * 0.5;
          const x2 = x + nx * streakLen * 0.5;
          const y2 = y + ny * streakLen * 0.5;
          
          const lum = (pr[i]*0.299 + pg[i]*0.587 + pb[i]*0.114);
          const g = Math.round(25 + (1 - lum/255) * 55);
          const grad = ctx.createLinearGradient(x1, y1, x2, y2);
          grad.addColorStop(0, `rgba(${g},${g},${g},0)`);
          grad.addColorStop(0.5, `rgba(${g},${g},${g},${alpha})`);
          grad.addColorStop(1, `rgba(${g},${g},${g},0)`);
          
          ctx.fillStyle = grad;
          const lineW = Math.max(s * 0.7, 0.5);
          ctx.fillRect(x1, y1 - lineW * 0.5, x2 - x1 || 0.1, lineW);
        } else {
          const sizeMod = 1 + speed * 0.1;
          const size = s * sizeMod;
          const lum2 = (pr[i]*0.299 + pg[i]*0.587 + pb[i]*0.114);
          const g2 = Math.round(25 + (1 - lum2/255) * 55);
          ctx.fillStyle = `rgba(${g2},${g2},${g2},${alpha})`;
          ctx.fillRect(x - size * 0.5, y - size * 0.5, size, size);
        }
      }
      
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      
      // Cursor indicator
      if (this.mouse.active && opts.cursorStrength > 0 && this.mouse.x > -9000) {
        const gradient = ctx.createRadialGradient(
          this.mouse.x, this.mouse.y, 0,
          this.mouse.x, this.mouse.y, opts.cursorRadius
        );
        gradient.addColorStop(0, 'rgba(30,30,30,0.04)');
        gradient.addColorStop(1, 'rgba(30,30,30,0)');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(this.mouse.x, this.mouse.y, opts.cursorRadius, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    _loop(now) {
      if (!this.running) return;
      
      const dt = Math.min((now - this.lastTime) / 16.67, 2);
      this.lastTime = now;
      
      this._updateParticles(dt);
      this._render();
      
      this.rafId = requestAnimationFrame(this._loop);
    }
  }

  // Export
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ParticleImage;
  } else {
    global.ParticleImage = ParticleImage;
  }

})(typeof window !== 'undefined' ? window : this);
