import "./styles.css";

const app = document.querySelector("#app");

let products = [];
let loading = false;
let error = "";

const CATEGORY_ORDER = [
  "Frutas y verduras",
  "Carnes y pescados",
  "Lácteos",
  "Panadería",
  "Despensa",
  "Congelados",
  "Bebidas",
  "Higiene y limpieza",
  "Otros"
];

function render() {
  const grouped = groupProducts(products);

  app.innerHTML = `
    <main class="page">
      <section class="hero">
        <p class="eyebrow">Lista de compra inteligente</p>
        <h1>Sube tu Word y genera la compra</h1>
        <p class="subtitle">
          Detecta ingredientes resaltados, sombreados o con color.
        </p>
      </section>

      <section class="upload-card">
        <label class="upload-zone">
          <input type="file" accept=".docx" id="fileInput" />
          <span class="upload-icon">📄</span>
          <strong>Subir archivo Word</strong>
          <small>Solo archivos .docx</small>
        </label>

        ${loading ? `<div class="status loading">Analizando documento...</div>` : ""}
        ${error ? `<div class="status error">${error}</div>` : ""}
      </section>

      ${
        products.length
          ? `
            <section class="summary">
              <span>${products.filter(product => !product.checked).length} pendientes</span>
              <span>${products.filter(product => product.checked).length} comprados</span>
            </section>

            <section class="shopping-list">
              ${CATEGORY_ORDER.map(category => renderCategory(category, grouped[category])).join("")}
            </section>
          `
          : `
            <section class="empty">
              <h2>Aún no hay productos</h2>
              <p>Sube un Word para empezar una lista nueva.</p>
            </section>
          `
      }
    </main>
  `;

  document.querySelector("#fileInput")?.addEventListener("change", handleUpload);

  document.querySelectorAll("[data-product-id]").forEach(button => {
    button.addEventListener("click", () => toggleProduct(button.dataset.productId));
  });
}

function renderCategory(category, items = []) {
  if (!items.length) return "";

  const ordered = [...items].sort((a, b) => Number(a.checked) - Number(b.checked));

  return `
    <article class="category-card">
      <h2>${category}</h2>
      <div class="items">
        ${ordered.map(renderProduct).join("")}
      </div>
    </article>
  `;
}

function renderProduct(product) {
  return `
    <button 
      class="product ${product.checked ? "checked" : ""}" 
      data-product-id="${product.id}"
    >
      <span class="check">${product.checked ? "✓" : ""}</span>
      <span class="product-text">
        <strong>${escapeHtml(product.name)}</strong>
        <small>${escapeHtml(product.quantity)}</small>
      </span>
    </button>
  `;
}

function groupProducts(items) {
  return items.reduce((acc, item) => {
    acc[item.category] ||= [];
    acc[item.category].push(item);
    return acc;
  }, {});
}

async function handleUpload(event) {
  const file = event.target.files[0];

  error = "";
  products = [];
  loading = true;
  render();

  if (!file) {
    loading = false;
    render();
    return;
  }

  if (!file.name.toLowerCase().endsWith(".docx")) {
    loading = false;
    error = "Archivo no válido. Sube un documento .docx.";
    render();
    return;
  }

  try {
    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch("/api/upload", {
      method: "POST",
      body: formData
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "No se pudo analizar el Word.");
    }

    products = data.products;
  } catch (err) {
    error = err.message;
  } finally {
    loading = false;
    render();
  }
}

function toggleProduct(id) {
  products = products.map(product =>
    product.id === id
      ? { ...product, checked: !product.checked }
      : product
  );

  render();
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

render();
