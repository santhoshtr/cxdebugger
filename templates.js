async function translate() {
  document.getElementById("progress").style.display = "block";

  const sourcelang = document.getElementById("source_lang").value;
  const targetlang = document.getElementById("target_lang").value;
  const title = document.getElementById("source_title").value;
  const targettitle = document.getElementById("target_title").value;
  const wikitext = document.getElementById("wikitext").value.trim();
  const res = await axios.post(
    `https://${sourcelang}.wikipedia.org/api/rest_v1/transform/wikitext/to/html/${title}`,
    { wikitext, body_only: true, stash: true }
  );
  const html = res.data;
  document.getElementById("sourcehtml").innerHTML = html;
  const translatedContent = await axios.post(
    `https://cxserver.wikimedia.org/v2/translate/${sourcelang}/${targetlang}`,
    { html: `<div>${html}</div>` }
  );

  //   console.table(document.querySelector("[data-cx]").dataset.cx);
  //   console.table(document.querySelector("[data-cx]").dataset.mw);
  const html2wt = await axios.post(
    `https://${targetlang}.wikipedia.org/api/rest_v1/transform/html/to/wikitext/${title}`,
    { html: translatedContent.data.contents }
  );
  const targetwikitext = html2wt.data;
  document.getElementById("targetwikitext").innerText = targetwikitext;
  const targethtml = await axios.post(
    `https://${targetlang}.wikipedia.org/api/rest_v1/transform/wikitext/to/html/${targettitle || title}`,
    { wikitext: targetwikitext, body_only: true, stash: true }
  );
  document.getElementById("targethtml").innerHTML = targethtml.data;
  document.getElementById("progress").style.display = "none";
}


document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("translate").onclick = translate;
})