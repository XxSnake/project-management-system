/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['pdf-to-img', 'pdfjs-dist', 'tesseract.js', 'mammoth', 'pdf-parse', 'word-extractor'],
};

export default nextConfig;
