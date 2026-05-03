function applyPremiumExcelStyle(worksheet, options = {}) {
  const {
    title = "",
    headerRowNumber = title ? 2 : 1,
    freezeRow = title ? 2 : 1,
    filterFrom = null,
    filterTo = null,
    statusColumn = null, // örn: "C" veya 3
  } = options;

  const totalCols = worksheet.columnCount;
  const lastColLetter = worksheet.getColumn(totalCols).letter;

  if (title) {
    worksheet.mergeCells(`A1:${lastColLetter}1`);

    const titleCell = worksheet.getCell("A1");
    titleCell.value = title;
    titleCell.font = { bold: true, size: 14, color: { argb: "FFFFFFFF" } };
    titleCell.alignment = { horizontal: "center", vertical: "middle" };
    titleCell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1F4E78" },
    };
    worksheet.getRow(1).height = 26;
  }

  const headerRow = worksheet.getRow(headerRowNumber);
  headerRow.height = 24;

  headerRow.eachCell((cell) => {
    cell.font = { bold: true, size: 11, color: { argb: "FFFFFFFF" } };
    cell.alignment = {
      horizontal: "center",
      vertical: "middle",
      wrapText: true,
    };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF203864" },
    };
    cell.border = {
      top: { style: "thin", color: { argb: "FFB7C9E2" } },
      left: { style: "thin", color: { argb: "FFB7C9E2" } },
      bottom: { style: "thin", color: { argb: "FFB7C9E2" } },
      right: { style: "thin", color: { argb: "FFB7C9E2" } },
    };
  });

  const totalRows = Math.max(worksheet.rowCount + 25, 90);

  for (let i = headerRowNumber + 1; i <= totalRows; i++) {
    const row = worksheet.getRow(i);

    for (let j = 1; j <= totalCols; j++) {
      const cell = row.getCell(j);

      const hasValue =
        cell.value !== null && cell.value !== undefined && cell.value !== "";

      cell.alignment = {
        vertical: "middle",
        horizontal: typeof cell.value === "number" ? "right" : "left",
        wrapText: true,
      };

      cell.border = {
        top: { style: "hair", color: { argb: "FFE5E7EB" } },
        left: { style: "hair", color: { argb: "FFE5E7EB" } },
        bottom: { style: "hair", color: { argb: "FFE5E7EB" } },
        right: { style: "hair", color: { argb: "FFE5E7EB" } },
      };

      if (!hasValue) {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFF3F4F6" },
        };
      } else if (i % 2 === 0) {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFF8FAFC" },
        };
      }

      if (statusColumn) {
        const statusColNumber =
          typeof statusColumn === "number"
            ? statusColumn
            : worksheet.getColumn(statusColumn).number;

        if (j === statusColNumber) {
          const status = String(cell.value || "").toUpperCase();

          if (status === "OK") {
            cell.font = { bold: true, color: { argb: "FF15803D" } };
          } else if (status === "PO_BEKLER") {
            cell.font = { bold: true, color: { argb: "FFD97706" } };
          } else if (status === "CANCEL") {
            cell.font = { bold: true, color: { argb: "FFB91C1C" } };
          } else if (status === "PARTIAL") {
            cell.font = { bold: true, color: { argb: "FF2563EB" } };
          }
        }
      }
    }
  }

  worksheet.views = [
    {
      state: "frozen",
      ySplit: freezeRow,
      showGridLines: false,
    },
  ];

  if (filterFrom && filterTo) {
    worksheet.autoFilter = {
      from: filterFrom,
      to: filterTo,
    };
  }
}

module.exports = { applyPremiumExcelStyle };