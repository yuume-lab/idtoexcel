import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI, Type } from "@google/genai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ID_CARD_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    name: { type: Type.STRING, description: "姓名" },
    gender: { type: Type.STRING, description: "性别 (男/女)" },
    ethnicity: { type: Type.STRING, description: "民族" },
    birthDate: { type: Type.STRING, description: "出生日期 (YYYY-MM-DD)" },
    address: { type: Type.STRING, description: "住址" },
    idNumber: { type: Type.STRING, description: "公民身份号码" },
  },
  required: ["name", "idNumber"],
};

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Body parser for large images
  app.use(express.json({ limit: '50mb' }));

  // --- Gemini OCR API ---
  // Moving this to server-side for security and to bypass China block if deployed outside
  app.post('/api/ocr', async (req, res) => {
    const { base64Data, mimeType } = req.body;
    
    if (!base64Data) {
      return res.status(400).json({ error: "Missing image data" });
    }

    try {
      const ai = new GoogleGenAI({ 
        apiKey: process.env.GEMINI_API_KEY || ''
      });
      
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
          {
            parts: [
              { text: "请识别这张中国身份证正面的所有信息，并以 JSON 格式输出。如果信息不清晰，请尽力识别。" },
              { inlineData: { data: base64Data, mimeType: mimeType || 'image/jpeg' } }
            ]
          }
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: ID_CARD_SCHEMA,
        }
      });

      const result = JSON.parse(response.text || '{}');
      res.json(result);
    } catch (err: any) {
      console.error("Gemini OCR Error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Health check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
