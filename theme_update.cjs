const fs = require('fs');
let content = fs.readFileSync('app/MatchApp.jsx', 'utf8');

// Replace colors carefully
content = content.replace(/#00e5c8/g, '#f59e0b');
content = content.replace(/#06b6d4/g, '#d97706');
content = content.replace(/#e2feff/g, '#f4f4f5');

// Dark backgrounds
content = content.replace(/#09181808/g, 'rgba(255,255,255,0.02)');
content = content.replace(/#09181810/g, 'rgba(255,255,255,0.03)');
content = content.replace(/#091818/g, 'rgba(255,255,255,0.04)');

content = content.replace(/#080c10/g, '#0a0a0e');
content = content.replace(/#04100c/g, 'rgba(18,18,22,0.92)');

// Text updates
content = content.replace(/⬡/g, '◈');
content = content.replace(/AI ANALYZING CANDIDATES/g, 'AI MATCHING CANDIDATES');
content = content.replace(/NEURAL/g, 'PREMIUM');
content = content.replace(/cyber-input/g, 'premium-input');

// Fonts
content = content.replace(/Orbitron, monospace/g, 'Outfit, sans-serif');
content = content.replace(/monospace/g, 'Inter, sans-serif');
content = content.replace(/@import url\('https:\/\/fonts.googleapis.com\/css2\?family=Orbitron:wght@400;700;900&display=swap'\);/g, '');

// Background replacement
const newBg = `function ParticleBackground() {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const setSize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
    setSize();
    const nodes = Array.from({ length: 50 }, () => ({
      x: Math.random() * canvas.width, y: Math.random() * canvas.height,
      vx: (Math.random() - 0.5) * 0.3, vy: (Math.random() - 0.5) * 0.3,
      r: Math.random() * 1.5 + 0.5, pulse: Math.random() * Math.PI * 2,
    }));
    let frame;
    const draw = () => {
      ctx.fillStyle = "rgba(10,10,14,0.18)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      nodes.forEach(n => {
        n.x += n.vx; n.y += n.vy; n.pulse += 0.018;
        if (n.x < 0 || n.x > canvas.width) n.vx *= -1;
        if (n.y < 0 || n.y > canvas.height) n.vy *= -1;
      });
      nodes.forEach((a, i) => {
        nodes.slice(i + 1).forEach(b => {
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d < 130) {
            ctx.beginPath();
            ctx.strokeStyle = \`rgba(245,158,11,\${(1 - d / 130) * 0.18})\`;
            ctx.lineWidth = 0.6;
            ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          }
        });
        const g = Math.sin(a.pulse) * 0.5 + 0.5;
        ctx.beginPath();
        ctx.arc(a.x, a.y, a.r + g * 0.5, 0, Math.PI * 2);
        ctx.fillStyle = \`rgba(245,158,11,\${0.25 + g * 0.3})\`;
        ctx.fill();
      });
      frame = requestAnimationFrame(draw);
    };
    draw();
    window.addEventListener("resize", setSize);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("resize", setSize); };
  }, []);
  return <canvas ref={canvasRef} style={{ position: "fixed", inset: 0, zIndex: 0, opacity: 0.7 }} />;
}`;

content = content.replace(/function NeuralBackground\(\) \{[\s\S]*?return <canvas ref=\{canvasRef\} style=\{\{ position: "fixed", inset: 0, zIndex: 0, opacity: 0\.6 \}\} \/>;\n\}/, newBg);
content = content.replace(/<NeuralBackground \/>/g, '<ParticleBackground />');

// Remove scanline
content = content.replace(/function ScanLine\(\) \{[\s\S]*?return \([\s\S]*?\);\n\}/, '');
content = content.replace(/<ScanLine \/>/g, '');

fs.writeFileSync('app/MatchApp.jsx', content, 'utf8');
