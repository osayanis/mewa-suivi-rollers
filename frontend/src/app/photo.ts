// Préparation des photos avant envoi : orientation corrigée, réduite à 1600 px, JPEG ≈ 200–400 Ko.
// Les photos des terminaux font souvent plusieurs Mo : réduites ici, elles partent vite sur le réseau de l'agence.

const MAX_SIDE = 1600;
const QUALITY = 0.82;

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Image illisible.'));
    };
    img.src = url;
  });
}

export async function toJpeg(file: Blob): Promise<Blob> {
  // Les navigateurs récents appliquent l'orientation EXIF de la photo en la dessinant.
  const img = await loadImage(file);
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (!w || !h) throw new Error('Image illisible.');
  const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const g = canvas.getContext('2d');
  if (!g) throw new Error('Image illisible.');
  g.drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Conversion impossible.'))), 'image/jpeg', QUALITY),
  );
}
