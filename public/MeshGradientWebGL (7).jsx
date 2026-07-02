// Trivial tweak: trigger rebuild for dev server
import React, { useRef, useEffect, useState, useCallback } from 'react';

// Helper: convert hex to [r,g,b] 0-1
function hexToRgb01(hex) {
  const m = hex.match(/^#([0-9a-f]{3,8})$/i);
  if (!m) return [1,1,1];
  let c = m[1];
  if (c.length === 3) c = c.split('').map(x=>x+x).join('');
  if (c.length === 6) c += 'ff';
  const num = parseInt(c, 16);
  return [((num>>24)&255), ((num>>16)&255), ((num>>8)&255)].slice(-3).map(v=>v/255);
}

// WebGL context management class
class WebGLManager {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = null;
    this.program = null;
    this.buffer = null;
    this.uniforms = {};
    this.isValid = false;
    this.contextLost = false;
    this.retryCount = 0;
    this.maxRetries = 3;
  }

  // Initialize WebGL context with robust error handling
  init() {
    try {
      // Force context creation with specific attributes
      this.gl = this.canvas.getContext('webgl', {
        alpha: false,
        antialias: true,
        depth: false,
        stencil: false,
        preserveDrawingBuffer: false,
        powerPreference: 'default',
        failIfMajorPerformanceCaveat: false
      }) || this.canvas.getContext('experimental-webgl', {
        alpha: false,
        antialias: true,
        depth: false,
        stencil: false,
        preserveDrawingBuffer: false,
        powerPreference: 'default',
        failIfMajorPerformanceCaveat: false
      });

      if (!this.gl) {
        throw new Error('WebGL not supported');
      }

      // Check for context loss
      this.gl.canvas.addEventListener('webglcontextlost', this.handleContextLost.bind(this), false);
      this.gl.canvas.addEventListener('webglcontextrestored', this.handleContextRestored.bind(this), false);

      // Test context validity
      this.gl.getError(); // Clear any existing errors
      this.gl.clearColor(0, 0, 0, 1);
      this.gl.clear(this.gl.COLOR_BUFFER_BIT);
      
      if (this.gl.getError() !== this.gl.NO_ERROR) {
        throw new Error('WebGL context test failed');
      }

      this.isValid = true;
      this.contextLost = false;
      this.retryCount = 0;
      return true;

    } catch (error) {
      console.warn('WebGL initialization failed:', error);
      this.isValid = false;
      return false;
    }
  }

  handleContextLost(event) {
    event.preventDefault();
    this.contextLost = true;
    this.isValid = false;
    console.warn('WebGL context lost');
  }

  handleContextRestored() {
    this.contextLost = false;
    this.isValid = false;
    console.log('WebGL context restored, reinitializing...');
    // Reinitialize after a short delay
    setTimeout(() => {
      if (this.init()) {
        this.createShaders();
        this.createBuffers();
      }
    }, 100);
  }

  // Helper: compile shader with logging
  compileShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const infoLog = gl.getShaderInfoLog(shader);
      console.error('Shader compilation failed:', infoLog);
      console.error('Source code:\n', source); // Helpful for debugging
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  // Create and compile shaders with error checking
  createShaders() {
    if (!this.gl || !this.isValid) return false;

    try {
      const MAX_POINTS = 7;
      
      const vertexShaderSource = `
        attribute vec2 a_position;
        void main() {
          gl_Position = vec4(a_position, 0.0, 1.0);
        }
      `;

      const fragmentShaderSource = `
        precision mediump float;
        uniform vec2 u_points[${MAX_POINTS}];
        uniform vec3 u_colors[${MAX_POINTS}];
        uniform int u_numPoints;
        uniform int u_userCount;
        uniform vec2 u_resolution;
        
        void main() {
          vec2 uv = gl_FragCoord.xy / u_resolution;
          vec3 color = vec3(0.0);
          float total = 0.0;
          
          // Adaptive sharpness and falloff: static is crisp, animated is just a bit softer
          float sharpness;
          float w;
          bool isAnimated = bool(u_resolution.x > 0.0 && u_resolution.y > 0.0 && u_resolution.x != u_resolution.y); // crude proxy, will be set by JS
          if (u_numPoints == 2) {
            sharpness = 2.2;
          } else if (u_numPoints <= 4) {
            sharpness = isAnimated ? 7.0 : 8.0;
          } else if (u_numPoints <= 6) {
            sharpness = isAnimated ? 8.0 : 9.5;
          } else {
            sharpness = isAnimated ? 9.0 : 11.0;
          }
          for (int i = 0; i < ${MAX_POINTS}; i++) {
            if (i < u_numPoints) {
              float d = distance(uv, u_points[i]);
              if (u_numPoints == 2) {
                w = exp(-d * d * sharpness);
              } else {
                w = exp(-d * sharpness);
              }
              color += u_colors[i] * w;
              total += w;
            }
          }
          if (total > 0.0) {
            color /= total;
          }
          gl_FragColor = vec4(color, 1.0);
        }
      `;

      // Use compileShader helper
      const vertexShader = this.compileShader(this.gl, this.gl.VERTEX_SHADER, vertexShaderSource);
      if (!vertexShader) throw new Error('Vertex shader compilation failed');
      const fragmentShader = this.compileShader(this.gl, this.gl.FRAGMENT_SHADER, fragmentShaderSource);
      if (!fragmentShader) throw new Error('Fragment shader compilation failed');

      // Create and link program
      this.program = this.gl.createProgram();
      this.gl.attachShader(this.program, vertexShader);
      this.gl.attachShader(this.program, fragmentShader);
      this.gl.linkProgram(this.program);
      
      if (!this.gl.getProgramParameter(this.program, this.gl.LINK_STATUS)) {
        throw new Error('Program linking failed: ' + this.gl.getProgramInfoLog(this.program));
      }

      // Get uniform locations
      this.uniforms = {
        points: this.gl.getUniformLocation(this.program, 'u_points'),
        colors: this.gl.getUniformLocation(this.program, 'u_colors'),
        numPoints: this.gl.getUniformLocation(this.program, 'u_numPoints'),
        userCount: this.gl.getUniformLocation(this.program, 'u_userCount'),
        resolution: this.gl.getUniformLocation(this.program, 'u_resolution')
      };

      // Clean up shaders
      this.gl.deleteShader(vertexShader);
      this.gl.deleteShader(fragmentShader);

      return true;

    } catch (error) {
      console.error('Shader creation failed:', error);
      this.isValid = false;
      return false;
    }
  }

  // Create buffers
  createBuffers() {
    if (!this.gl || !this.isValid) return false;

    try {
      // Create vertex buffer
      this.buffer = this.gl.createBuffer();
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.buffer);
      
      // Full-screen quad vertices
      const vertices = new Float32Array([
        -1, -1,
         1, -1,
        -1,  1,
         1,  1
      ]);
      
      this.gl.bufferData(this.gl.ARRAY_BUFFER, vertices, this.gl.STATIC_DRAW);
      return true;

    } catch (error) {
      console.error('Buffer creation failed:', error);
      this.isValid = false;
      return false;
    }
  }

  // Render function
  render(points, colors, numPoints, width, height) {
    if (!this.gl || !this.isValid || !this.program || !this.buffer) {
      return false;
    }

    try {
      // Set viewport
      this.gl.viewport(0, 0, width, height);
      
      // Use program
      this.gl.useProgram(this.program);
      
      // Set uniforms
      this.gl.uniform2fv(this.uniforms.points, points);
      this.gl.uniform3fv(this.uniforms.colors, colors);
      this.gl.uniform1i(this.uniforms.numPoints, numPoints);
      this.gl.uniform1i(this.uniforms.userCount, Math.floor(numPoints / 2));
      this.gl.uniform2f(this.uniforms.resolution, width, height);
      
      // Set up vertex attributes
      const positionLocation = this.gl.getAttribLocation(this.program, 'a_position');
      this.gl.enableVertexAttribArray(positionLocation);
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.buffer);
      this.gl.vertexAttribPointer(positionLocation, 2, this.gl.FLOAT, false, 0, 0);
      
      // Draw
      this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);
      
      return true;

    } catch (error) {
      console.error('Render failed:', error);
      this.isValid = false;
      return false;
    }
  }

  // Cleanup resources
  cleanup() {
    if (this.gl) {
      if (this.buffer) {
        this.gl.deleteBuffer(this.buffer);
        this.buffer = null;
      }
      if (this.program) {
        this.gl.deleteProgram(this.program);
        this.program = null;
      }
      this.gl = null;
    }
    this.isValid = false;
    this.uniforms = {};
  }
}

const WIDTH = 900;
const HEIGHT = 500;
const MAX_POINTS = 7;

const MeshGradientWebGL = ({ colors = [], numPoints = 2, animate = false, width = WIDTH, height = HEIGHT }) => {
  const canvasRef = useRef();
  const webglManagerRef = useRef();
  const animationRef = useRef();
  const baseParamsRef = useRef();
  const [error, setError] = useState(null);

  // Initialize WebGL
  const initializeWebGL = useCallback(() => {
    if (!canvasRef.current) return false;

    try {
      // Cleanup previous instance
      if (webglManagerRef.current) {
        webglManagerRef.current.cleanup();
      }

      // Create new WebGL manager
      webglManagerRef.current = new WebGLManager(canvasRef.current);
      
      // Initialize WebGL
      if (!webglManagerRef.current.init()) {
        throw new Error('WebGL initialization failed');
      }

      // Create shaders and buffers
      if (!webglManagerRef.current.createShaders()) {
        throw new Error('Shader creation failed');
      }

      if (!webglManagerRef.current.createBuffers()) {
        throw new Error('Buffer creation failed');
      }

      setError(null);
      return true;

    } catch (err) {
      console.error('WebGL setup failed:', err);
      setError(err.message);
      return false;
    }
  }, []);

  // Render function
  const render = useCallback((points, colors, numPoints) => {
    if (!webglManagerRef.current || !webglManagerRef.current.isValid) {
      return false;
    }

    return webglManagerRef.current.render(points, colors, numPoints, width, height);
  }, [width, height]);

  // Animation function
  const animateFrame = useCallback((colors, numPoints) => {
    if (!webglManagerRef.current || !webglManagerRef.current.isValid) {
      console.log('WebGL not valid, skipping animation frame');
      return;
    }

    const t = performance.now() * 0.0012; // Slightly faster for more dynamic movement
    const n = Math.min(colors.length, numPoints, MAX_POINTS);
    
    // Initialize base parameters if needed
    if (!baseParamsRef.current || baseParamsRef.current.length !== MAX_POINTS || baseParamsRef.current[0]?.numPoints !== n) {
      baseParamsRef.current = Array.from({ length: MAX_POINTS }, (_, i) => ({
        baseAngle: (i / n) * Math.PI * 2,
        baseRadius: 0.35 + (i * 0.05),
        // Simple animation parameters
        freqA: 0.4 + (i * 0.08),
        freqR: 0.3 + (i * 0.06),
        phaseA: (i / n) * Math.PI * 2,
        phaseR: (i / n) * Math.PI * 2 + Math.PI,
        numPoints: n,
      }));
    }

    // Calculate animated points using same logic as static but with animation
    let points = [];
    if (n === 2) {
      // Liquid, organic 2-color animation: points orbit and can exchange sides
      const baseAngle = Math.PI / 4;
      const baseR = 0.22;
      // Animate both angle and radius for each point independently
      const t1 = t * 0.7;
      const t2 = t * 0.9 + Math.PI / 2; // phase offset for unsynchronized motion
      // Point 1
      const angle1 = baseAngle + Math.sin(t1) * 1.2 + Math.cos(t1 * 0.5) * 0.7;
      const r1 = baseR + Math.sin(t1 * 0.8) * 0.07 + Math.cos(t1 * 0.3) * 0.04;
      // Point 2
      const angle2 = baseAngle + Math.PI + Math.cos(t2) * 1.2 + Math.sin(t2 * 0.5) * 0.7;
      const r2 = baseR + Math.cos(t2 * 0.8) * 0.07 + Math.sin(t2 * 0.3) * 0.04;
      points = [
        0.5 + Math.cos(angle1) * r1, 0.5 + Math.sin(angle1) * r1,
        0.5 + Math.cos(angle2) * r2, 0.5 + Math.sin(angle2) * r2
      ];
    } else {
      // Apple-style fluid animation for 3+ colors: orbit + global breathing (pulse)
      const globalBreath = 0.13 + 0.07 * Math.sin(t * 0.23); // slow global breathing
      for (let i = 0; i < n; i++) {
        const angleBase = (i / n) * Math.PI * 2;
        // Two oscillation layers for angle
        const angle = angleBase
          + Math.sin(t * (0.7 + i * 0.13) + i) * 0.38
          + Math.sin(t * (0.23 + i * 0.07) + i * 1.7) * 0.18;
        // Apple-style: add global breathing to radius
        const radius = 0.32 + 0.08 * Math.sin(i * 2.1)
          + Math.cos(t * (0.6 + i * 0.11) + i * 0.8) * 0.09
          + Math.sin(t * (0.19 + i * 0.09) + i * 2.2) * 0.04
          + globalBreath;
        points.push(
          0.5 + Math.cos(angle) * radius,
          0.5 + Math.sin(angle) * radius
        );
      }
    }
    // Fill remaining slots with zeros (same as static)
    while (points.length < MAX_POINTS * 2) {
      points.push(0, 0);
    }

    // Prepare colors - only use the exact colors provided, no additional colors
    const colorArray = colors.map(hexToRgb01);
    while (colorArray.length < MAX_POINTS) {
      colorArray.push(colorArray[colorArray.length - 1] || [1, 1, 1]);
    }

    // Debug logging
    console.log('Animation frame:', {
      numPoints: n,
      colorsLength: colors.length,
      points: points.slice(0, n * 2),
      colorArray: colorArray.slice(0, n)
    });

    // Render
    const renderSuccess = render(points, colorArray.flat(), n);
    if (renderSuccess) {
      animationRef.current = requestAnimationFrame(() => animateFrame(colors, numPoints));
    } else {
      console.error('Render failed in animation frame');
    }
  }, [render]);

  // Main effect for setup and rendering
  useEffect(() => {
    // Initialize WebGL
    if (!initializeWebGL()) {
      return;
    }

    const n = Math.min(colors.length, numPoints, MAX_POINTS);
    let points = [];
    if (!animate) {
      if (n === 2) {
        // Static, soft, organic 2-color blend: points near center, offset in opposite directions
        const angle = Math.PI / 4;
        const r = 0.22;
        points = [
          0.5 + Math.cos(angle) * r, 0.5 + Math.sin(angle) * r,
          0.5 - Math.cos(angle) * r, 0.5 - Math.sin(angle) * r
        ];
      } else {
        // Uniform circular layout for 3+ colors: maximize separation (no t)
        for (let i = 0; i < n; i++) {
          const angle = (i / n) * Math.PI * 2;
          const radius = 0.32 + 0.08 * Math.sin(i * 2.1);
          points.push(
            0.5 + Math.cos(angle) * radius,
            0.5 + Math.sin(angle) * radius
          );
        }
      }
      // Fill remaining slots with zeros
      while (points.length < MAX_POINTS * 2) {
        points.push(0, 0);
      }
      const colorArray = colors.map(hexToRgb01);
      while (colorArray.length < MAX_POINTS) {
        colorArray.push([1, 1, 1]);
      }
      render(points, colorArray.flat(), n);
    } else {
      animateFrame(colors, numPoints);
    }
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
    };
  }, [colors, numPoints, animate, initializeWebGL, render, animateFrame]);

  // Retry mechanism
  const handleRetry = useCallback(() => {
    setError(null);
    setTimeout(() => {
      initializeWebGL();
    }, 100);
  }, [initializeWebGL]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      if (webglManagerRef.current) {
        webglManagerRef.current.cleanup();
      }
    };
  }, []);

  return (
    <div style={{ 
      width: '100%', 
      height: 'auto', 
      borderRadius: '1.5rem', 
      display: 'block', 
      margin: '0 auto', 
      position: 'relative',
      background: '#f0f0f0'
    }}>
      <canvas 
        ref={canvasRef} 
        width={width} 
        height={height} 
        style={{ 
          width: '100%', 
          height: 'auto', 
          borderRadius: '1.5rem', 
          display: 'block', 
          margin: '0 auto',
          background: '#f0f0f0'
        }} 
      />
      
      {error && (
        <div style={{
          position: 'absolute',
          top: 0, 
          left: 0, 
          width: '100%', 
          height: '100%',
          background: 'rgba(255,255,255,0.98)',
          color: '#333',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '1.2rem',
          fontWeight: 500,
          borderRadius: '1.5rem',
          zIndex: 10,
          padding: '2rem',
          textAlign: 'center'
        }}>
          <div style={{ marginBottom: '1rem' }}>
            <strong>WebGL Error:</strong> {error}
          </div>
          <div style={{ marginBottom: '1.5rem', fontSize: '1rem', color: '#666' }}>
            This might be due to browser limitations or system resources.
          </div>
          <button 
            onClick={handleRetry}
            style={{
              background: '#007bff',
              color: 'white',
              border: 'none',
              padding: '0.75rem 1.5rem',
              borderRadius: '0.5rem',
              fontSize: '1rem',
              cursor: 'pointer',
              fontWeight: 600
            }}
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
};

export default MeshGradientWebGL;
