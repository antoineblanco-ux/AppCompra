import express from "express";
import multer from "multer";
import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { createServer as createViteServer } from "vite";

const app = express();
const PORT = 5173;

const UPLOAD_DIR = "uploads";
const LOG_DIR = "logs";
const LOG_FILE = path.join(LOG_DIR, "app.log");

await fs.mkdir(UPLOAD_DIR, { recursive: true });
await fs.mkdir(LOG_DIR, { recursive: true });

async function log(level, message, meta = {}) {
  const line = JSON.stringify({
    time: new Date().toISOString(),
    level,
    message,
    ...meta
  });

  await fs.appendFile(LOG_FILE, line + "\n", "utf8");
}

const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: 10 * 1024 * 1024 }
});

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  textNodeName: "#text"
});

const CATEGORY_RULES = {
  "Panes, leche y cafés": [
    "leche","pan", "piadina", "pita", "picos", "grisinni", "café", "oblea", "Leche Desna", "Leche Fresca"
  ],
  "Frutas y verduras": [
    "papaya", "mango", "piña", "melón", "uvas", "plátano", "manzana", "pera",
    "naranja", "fresa", "sandía", "limón", "lima", "arándano", "frambuesa",
    "aguacate", "calabacín", "calabaza", "puerro", "champi", "berenjena",
    "cebolla", "ajo", "tomate", "lechuga", "espinaca", "rúcula", "zanahoria",
    "apio", "boniato", "patata", "brócoli", "repollo", "pimiento", "pepino",
    "perejil", "cilantro", "albahaca", "nectarina", "hierbabuena"
  ],
  "Quesos y fiambres": [
	"queso", "burrata", "mozzarella","parmesano", "philadelphia", "ricotta", "requesón",
	"nata", "jamón", "lomo", "fuet", "salchicha"
  ],
  "Carnes y pescados": [
    "pollo", "merluza", "pescadilla", "gallo", "carne", "hamburguesa",
    "cordero", "cerdo", "pavo", "salmón", "lubina", "sardina", "rape",
    "sepia", "mejillón", "pulpo", "presa", "secreto", "solomillo",
    "costillar", "langostino", "contramuslos", "pechuga", "alitas", "Hamburguesas", "Carne Picada"
  ],
  "Lácteos": [
     "yogur", "actimel", "kéfir", 
     "mantequilla"
  ],
  "Despensa": [
     "cacao", "avena", "galleta", "aceite", "aove", "ketchup",
    "mahonesa", "totopos", "tomate frito", "Tomate triturado", "Tomate triturado 600gr", "atún",
    "ventresca", "pepinillo", "maíz", "lentejas", "garbanzos", "judías",
    "arroz", "pasta", "sal", "especias", "panela", "harina", "vinagre",
    "huevo", "caldo", "quinoa", "comino", "curry", "leche de coco", "menestra"
  ],
  "Congelados": [
    "congelado", "guisantes", "edamame", "frutos rojos", "hielos",
    "salteado"
  ],
  "Bebidas": [
    "vino", "cocacola", "cerveza", "agua", "gazpacho", "salmorejo"
  ],
  "Higiene y limpieza": [
    "desodorante", "pasta dientes", "crema", "gel", "champú", "compresas",
    "támpax", "jabón", "cuchillas", "ariel", "suavizante", "don limpio",
    "lejía", "amoniaco", "cristasol", "fairy", "sanytol", "papel higiénico",
    "papel cocina", "servilletas", "bolsas basura"
  ]
};

const UNIT_REGEX =
  /(\d+(?:[.,]\d+)?(?:\s*-\s*\d+(?:[.,]\d+)?)?)\s*(kg|kilo|kilos|gr|g|gramos|l|litro|litros|ml|cl|ud|uds|unidad|unidades|bote|botes|paq|paquete|paquetes|caja|cajas)?|x\s?(\d+)/i;

function normalizeArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function getTextFromNode(node) {
   if (!node) return "";
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);

  let text = "";

  if (node["#text"]) {
    text += node["#text"];
  }

  for (const key of Object.keys(node)) {
    // Ignorar atributos XML como xml:space="preserve"
    if (
      key === "#text" ||
      key.startsWith("@") ||
      key === "xml:space" ||
      key === "space" ||
      key === "preserve"
    ) {
      continue;
    }

    const child = node[key];

    if (Array.isArray(child)) {
      text += child.map(getTextFromNode).join("");
    } else if (typeof child === "object") {
      text += getTextFromNode(child);
    } else if (typeof child === "string") {
      text += child;
    }
  }

  return text;
}

function runHasVisualMark(run) {
  const props = run["w:rPr"];
  if (!props) return false;

  const highlight = props["w:highlight"];
  const shade = props["w:shd"];
  const color = props["w:color"];

  if (highlight) return true;

  if (shade) {
    const fill = shade.fill || shade["w:fill"];
    if (fill && fill !== "auto" && fill !== "FFFFFF") return true;
  }

  if (color) {
    const val = color.val || color["w:val"];
    if (val && val !== "auto" && val !== "000000") return true;
  }

  return false;
}

function extractMarkedTexts(xmlObject) {
  const paragraphs = [];

  function walk(node) {
    if (!node || typeof node !== "object") return;

    if (node["w:p"]) {
      for (const p of normalizeArray(node["w:p"])) {
        const markedChunks = [];
        const fullTextChunks = [];

        for (const run of normalizeArray(p["w:r"])) {
          const runText = getTextFromNode(run["w:t"]).trim();

          if (!runText) continue;

          fullTextChunks.push(runText);

          if (runHasVisualMark(run)) {
            markedChunks.push(runText);
          }
        }

        if (markedChunks.length) {
          paragraphs.push({
            markedText: cleanText(markedChunks.join(" ")),
            context: cleanText(fullTextChunks.join(" "))
          });
        }
      }
    }

    for (const key of Object.keys(node)) {
      const child = node[key];

      if (Array.isArray(child)) child.forEach(walk);
      else if (typeof child === "object") walk(child);
    }
  }

  walk(xmlObject);

  return paragraphs;
}

function cleanText(text) {
  return String(text)
    .replace(/preserve/gi, "")
    .replace(/[•\t\r\n]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitPossibleIngredients(text) {
  return cleanText(text)
    .split(/\s+\/\s+|,\s*|;\s*/)
    .map(cleanText)
    .filter(Boolean);
}

function inferQuantity(text, context) {
  const source = `${text} ${context}`;
  const match = source.match(UNIT_REGEX);

  if (!match) return "cantidad no especificada";

  if (match[3]) return `x${match[3]}`;

  const amount = match[1];
  const unit = match[2] || "ud";

  return `${amount} ${unit}`.trim();
}

function categorize(name) {
  const lower = name.toLowerCase();

  for (const [category, words] of Object.entries(CATEGORY_RULES)) {
    if (words.some(word => lower.includes(word))) {
      return category;
    }
  }

  return "Otros";
}

function mergeDuplicates(products) {
  const map = new Map();

  for (const product of products) {
    const key = `${product.name.toLowerCase()}-${product.category}`;

    if (!map.has(key)) {
      map.set(key, product);
    } else {
      const existing = map.get(key);

      if (
        existing.quantity === "cantidad no especificada" &&
        product.quantity !== "cantidad no especificada"
      ) {
        existing.quantity = product.quantity;
      }
    }
  }

  return [...map.values()];
}

async function parseDocx(filePath, originalName) {
  await log("info", "Iniciando lectura de Word", { originalName });

  const buffer = await fs.readFile(filePath);
  const zip = await JSZip.loadAsync(buffer);

  const documentFile = zip.file("word/document.xml");

  if (!documentFile) {
    await log("error", "No existe word/document.xml dentro del docx", { originalName });
    throw new Error("No se pudo leer el contenido principal del Word.");
  }

  const documentXml = await documentFile.async("string");
  const xmlObject = parser.parse(documentXml);
  const markedTexts = extractMarkedTexts(xmlObject);

  await log("info", "Textos marcados detectados", {
    originalName,
    count: markedTexts.length,
    samples: markedTexts.slice(0, 5)
  });

  const products = [];

  for (const item of markedTexts) {
    const parts = splitPossibleIngredients(item.markedText);

    for (const part of parts) {
      if (!part || part.length < 2) continue;

      products.push({
        id: crypto.randomUUID(),
        name: part,
        quantity: inferQuantity(part, item.context),
        category: categorize(part),
        checked: false
      });
    }
  }

  const merged = mergeDuplicates(products);

  await log("info", "Productos generados", {
    originalName,
    count: merged.length,
    categories: [...new Set(merged.map(product => product.category))]
  });

  return merged;
}

app.post("/api/upload", upload.single("file"), async (req, res) => {
  let uploadedPath = req.file?.path;

  try {
    await log("info", "Petición de subida recibida", {
      fileName: req.file?.originalname,
      mimeType: req.file?.mimetype,
      size: req.file?.size
    });

    if (!req.file) {
      await log("warn", "Subida sin archivo");
      return res.status(400).json({ error: "No se ha subido ningún archivo." });
    }

    const ext = path.extname(req.file.originalname).toLowerCase();

    if (ext !== ".docx") {
      await log("warn", "Archivo rechazado por extensión", {
        fileName: req.file.originalname,
        ext
      });

      await fs.unlink(req.file.path);

      return res.status(400).json({
        error: "Archivo no válido. Sube un documento .docx."
      });
    }

    const products = await parseDocx(req.file.path, req.file.originalname);

    await fs.unlink(req.file.path);
    uploadedPath = null;

    if (!products.length) {
      await log("warn", "Word sin ingredientes detectables", {
        fileName: req.file.originalname
      });

      return res.status(422).json({
        error: "No se han detectado ingredientes sombreados, resaltados o con color."
      });
    }

    return res.json({ products });
  } catch (error) {
    await log("error", "Error procesando Word", {
      fileName: req.file?.originalname,
      errorMessage: error.message,
      stack: error.stack
    });

    return res.status(500).json({
      error: "Ha habido un problema leyendo el documento Word. Revisa logs/app.log."
    });
  } finally {
    if (uploadedPath) {
      try {
        await fs.unlink(uploadedPath);
      } catch {}
    }
  }
});

const vite = await createViteServer({
  server: { middlewareMode: true },
  appType: "spa",
  allowedHosts: 'all'
});

app.use(vite.middlewares);
//const port = process.env.PORT || 5173;
const port = 5173;

// El '0.0.0.0' es fundamental para que Render pueda "ver" tu app
app.listen(port, '0.0.0.0', () => {
  console.log(`Servidor funcionando en puerto ${port}`);
});

  console.log(`App disponible en http://localhost:${PORT}`);
  console.log(`Log de errores en ${LOG_FILE}`);
