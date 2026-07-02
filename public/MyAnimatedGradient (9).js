// Complete animated mesh gradient setup
import React from 'react';
import MeshGradientWebGL from './components/MeshGradientWebGL';

// Gradient configuration
const meshGradientConfig = {
  "colors": [
    "#a40e4c",
    "#91efb1",
    "#7371fc",
    "#abe6e6",
    "#ff8aa6",
    "#92caa5"
  ],
  "numPoints": 6,
  "animate": true,
  "width": 900,
  "height": 500
};

// Usage in your component
function MyAnimatedGradient() {
  return (
    <div style={{ 
      maxWidth: 900, 
      margin: '0 auto', 
      boxShadow: '0 8px 32px rgba(0,0,0,0.1)', 
      borderRadius: '1.5rem', 
      overflow: 'hidden' 
    }}>
      <MeshGradientWebGL {...meshGradientConfig} />
    </div>
  );
}

export default MyAnimatedGradient;
