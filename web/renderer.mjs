export function drawBoard(canvas, snapshot) {
  const ctx = canvas.getContext('2d');
  const size = canvas.width, cell = size / snapshot.cols;
  ctx.fillStyle = '#18251e';
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = '#22372a';
  ctx.lineWidth = 1;
  for (let i = 1; i < snapshot.cols; i += 1) {
    ctx.beginPath(); ctx.moveTo(i * cell, 0); ctx.lineTo(i * cell, size); ctx.stroke();
  }
  for (let i = 1; i < snapshot.rows; i += 1) {
    ctx.beginPath(); ctx.moveTo(0, i * cell); ctx.lineTo(size, i * cell); ctx.stroke();
  }
  const cy = size / snapshot.rows;
  if (snapshot.food) {
    const x = (snapshot.food.x + .5) * cell, y = (snapshot.food.y + .55) * cy;
    ctx.fillStyle = '#ef846e';
    ctx.beginPath(); ctx.arc(x, y, cell * .32, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#e7cb76'; ctx.fillRect(x, y - cy * .46, cell * .09, cy * .2);
  }
  snapshot.snake.forEach((p, index) => {
    ctx.fillStyle = index === 0 ? '#d4f3a6' : '#66ba84';
    const inset = cell * .08;
    ctx.beginPath();
    ctx.roundRect(p.x * cell + inset, p.y * cy + inset, cell - inset * 2, cy - inset * 2, cell * .12);
    ctx.fill();
    if (index !== 0) return;
    const x = p.x * cell, y = p.y * cy;
    const eyes = {
      RIGHT: [[.7, .28], [.7, .7]], LEFT: [[.25, .28], [.25, .7]],
      UP: [[.28, .25], [.7, .25]], DOWN: [[.28, .7], [.7, .7]],
    }[snapshot.direction];
    ctx.fillStyle = '#18251e';
    eyes.forEach(([ex, ey]) => ctx.fillRect(x + cell * ex, y + cy * ey, cell * .1, cy * .1));
  });
}
