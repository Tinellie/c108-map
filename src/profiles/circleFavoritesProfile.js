export const circleFavoritesProfile = {
  name: "circle-favorites",
  description: "Extract circle favorites rows from classic-webcatalog.circle.ms",
  loginWait: {
    enabled: true,
    // If title contains this keyword, treat page as login state.
    loginTitleKeyword: "ログイン",
    loginFormSelector: "form#loginform",
    usernameSelector: "#Username",
    passwordSelector: "#Password",
    submitSelector: "#loginbtn",
    invalidCredentialSelector: "span.field-validation-error[data-valmsg-for='Password']",
    invalidCredentialText: "メールアドレスまたはパスワードが違います",
    // Wait until at least one target row appears after manual login.
    successSelector: "table.md-infotable.t-user-favorites tr.webcatalog-circle-list-detail",
    timeoutMs: 300000
  },
  selectors: {
    row: "table.md-infotable.t-user-favorites tr.webcatalog-circle-list-detail"
  },
  pagination: {
    enabled: true,
    navLinkSelector: ".m-pagination-container .m-pagination-nav a[href]",
    lastLinkTextIncludes: [">>"],
    prevLinkTextIncludes: ["<前", "前", "<<"]
  },
  extractor: ({ selectors }) => {
    const cleanText = (value) => (value || "").replace(/\s+/g, " ").trim();
    const parseCircleIdFromUrl = (urlValue) => {
      const url = String(urlValue || "");
      const fromPath = url.match(/\/Circle\/(\d+)/i);
      if (fromPath?.[1]) {
        return fromPath[1];
      }

      const fromQuery = url.match(/[?&](?:circle_id|id)=(\d+)/i);
      if (fromQuery?.[1]) {
        return fromQuery[1];
      }

      return "";
    };

    const resolveCircleId = (row, nameNode) => {
      const candidates = [
        row?.getAttribute("id") || "",
        row?.getAttribute("data-circle-id") || "",
        row?.getAttribute("data-circleid") || "",
        nameNode?.getAttribute("data-circle-id") || "",
        nameNode?.getAttribute("data-circleid") || "",
        parseCircleIdFromUrl(nameNode?.getAttribute("href") || "")
      ];

      for (const candidate of candidates) {
        const text = cleanText(candidate);
        const matched = text.match(/(\d{6,})/);
        if (matched?.[1]) {
          return matched[1];
        }
      }

      return "";
    };

    const primaryRows = Array.from(document.querySelectorAll(selectors.row));
    const fallbackRows =
      primaryRows.length > 0
        ? primaryRows
        : Array.from(
            document.querySelectorAll(
              "table.md-infotable.t-user-favorites tr:has(td.infotable-circlename a)"
            )
          );
    const rows = fallbackRows.reverse();

    return rows.map((row) => {
      const colorCell = row.querySelector("td.infotable-box.favorite-color");
      const imageNodes = Array.from(row.querySelectorAll(".img-circlecut img"));
      const locationNode = row.querySelector("td.infotable-space span[data-bind*='HaichiStr']") || row.querySelector("td.infotable-space span");
      const nameNode = row.querySelector("td.infotable-circlename a");
      const genreNode = row.querySelector("td.infotable-genre");
      const memoRow = row.nextElementSibling;
      const memoNode = memoRow?.querySelector("td.infotable-left span[data-bind*='favMemo']") || memoRow?.querySelector("td.infotable-left span");
      const circleId = resolveCircleId(row, nameNode);

      const color = colorCell
        ? window.getComputedStyle(colorCell).backgroundColor || colorCell.style.backgroundColor || null
        : null;

      const boothLocation = cleanText(locationNode?.textContent || "");
      const memo = cleanText(memoNode?.textContent || "");

      return {
        type: "circle",
        key: circleId || row.getAttribute("id") || null,
        text: cleanText(nameNode?.textContent || ""),
        value: boothLocation,
        metadata: {
          circleId: circleId || null,
          bgColor: color,
          imageUrls: imageNodes
            .map((img) => img.getAttribute("src") || "")
            .filter((src) => src.length > 0),
          booth_location: boothLocation,
          name: cleanText(nameNode?.textContent || ""),
          detailUrl: nameNode?.getAttribute("href") || null,
          genre: cleanText(genreNode?.textContent || ""),
          memo
        }
      };
    });
  }
};
