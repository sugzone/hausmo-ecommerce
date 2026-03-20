/**
 * Shopify Orders Report — Google Apps Script
 *
 * SETUP:
 * 1. In Google Sheets, open Extensions > Apps Script and paste this file.
 * 2. Save, then reload the spreadsheet.
 * 3. Use the "Shopify Reports" menu > "Set Credentials" to enter your
 *    shop domain and Admin API access token.
 * 4. Set your date range on the Config sheet (created automatically on first run).
 * 5. Use "Shopify Reports" menu > "Generate Orders Report".
 *
 * SHOPIFY API TOKEN:
 * Create a Custom App in your Shopify admin (Settings > Apps > Develop apps).
 * Grant it the "read_orders" Admin API scope.
 */

// ── Menu ─────────────────────────────────────────────────────────────────────

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Shopify Reports')
    .addItem('Generate Orders Report', 'generateReport')
    .addSeparator()
    .addItem('Set Credentials', 'showCredentialsDialog')
    .addToUi();
}

// ── Credentials ───────────────────────────────────────────────────────────────

function showCredentialsDialog() {
  const ui = SpreadsheetApp.getUi();

  const domainRes = ui.prompt(
    'Shopify Setup (1/2)',
    'Enter your shop domain (e.g. my-store.myshopify.com):',
    ui.ButtonSet.OK_CANCEL
  );
  if (domainRes.getSelectedButton() !== ui.Button.OK) return;

  const tokenRes = ui.prompt(
    'Shopify Setup (2/2)',
    'Enter your Admin API access token:',
    ui.ButtonSet.OK_CANCEL
  );
  if (tokenRes.getSelectedButton() !== ui.Button.OK) return;

  PropertiesService.getScriptProperties().setProperties({
    SHOP_DOMAIN: domainRes.getResponseText().trim(),
    ACCESS_TOKEN: tokenRes.getResponseText().trim(),
  });

  ui.alert('Credentials saved successfully.');
}

function getCredentials() {
  const props = PropertiesService.getScriptProperties();
  const domain = props.getProperty('SHOP_DOMAIN');
  const token = props.getProperty('ACCESS_TOKEN');
  if (!domain || !token) {
    throw new Error(
      'Shopify credentials not set. Use Shopify Reports > Set Credentials.'
    );
  }
  return {
    domain,
    token,
    apiVersion: props.getProperty('API_VERSION') || '2025-01',
  };
}

// ── Report ────────────────────────────────────────────────────────────────────

function generateReport() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // Ensure Config sheet exists with date inputs
  let configSheet = ss.getSheetByName('Config');
  if (!configSheet) {
    configSheet = ss.insertSheet('Config');
    configSheet.getRange('A1').setValue('Start Date');
    configSheet.getRange('A2').setValue('End Date');
    const now = new Date();
    configSheet
      .getRange('B1')
      .setValue(new Date(now.getFullYear(), now.getMonth(), 1));
    configSheet.getRange('B2').setValue(now);
    configSheet.getRange('B1:B2').setNumberFormat('yyyy-mm-dd');
    configSheet.autoResizeColumns(1, 2);
    ui.alert(
      'A Config sheet was created.\n\n' +
        'Set your date range in B1 (start) and B2 (end), then run again.'
    );
    return;
  }

  const startVal = configSheet.getRange('B1').getValue();
  const endVal = configSheet.getRange('B2').getValue();

  if (!startVal || !endVal) {
    ui.alert(
      'Please enter a start date in B1 and an end date in B2 on the Config sheet.'
    );
    return;
  }

  const startDate = Utilities.formatDate(new Date(startVal), 'UTC', 'yyyy-MM-dd');
  const endDate = Utilities.formatDate(new Date(endVal), 'UTC', 'yyyy-MM-dd');

  // Fetch orders
  let orders;
  try {
    orders = fetchAllOrders(startDate, endDate);
  } catch (e) {
    ui.alert('Error fetching orders:\n\n' + e.message);
    return;
  }

  // Write to Report sheet
  let reportSheet = ss.getSheetByName('Report');
  if (!reportSheet) {
    reportSheet = ss.insertSheet('Report');
  } else {
    reportSheet.clearContents();
    reportSheet.clearFormats();
  }

  const HEADERS = [
    'Order ID',
    'Confirmed',
    'Created At',
    'Shipping Address',
    'Items Ordered',
    'Fees',
    'Shipping Paid',
    'Sales Tax Paid',
    'Discount',
    'Gross',
    'Net',
  ];

  const rows = [HEADERS];

  for (const order of orders) {
    rows.push([
      order.name,
      order.confirmed,
      order.createdAt ? new Date(order.createdAt) : '',
      formatAddress(order.shippingAddress),
      formatLineItems(order.lineItems),
      moneyAmount(order.currentTotalAdditionalFeesSet),
      moneyAmount(order.currentShippingPriceSet),
      moneyAmount(order.totalTaxSet),
      moneyAmount(order.totalDiscountsSet),
      moneyAmount(order.currentTotalPriceSet),
      moneyAmount(order.subtotalPriceSet),
    ]);
  }

  reportSheet.getRange(1, 1, rows.length, HEADERS.length).setValues(rows);

  // Style header row
  const headerRange = reportSheet.getRange(1, 1, 1, HEADERS.length);
  headerRange.setFontWeight('bold');
  headerRange.setBackground('#222222');
  headerRange.setFontColor('#ffffff');

  if (rows.length > 1) {
    const dataRows = rows.length - 1;

    // Created At column (col 3) — date format
    reportSheet.getRange(2, 3, dataRows, 1).setNumberFormat('yyyy-mm-dd');

    // Money columns (cols 6–11): Fees, Shipping, Tax, Discount, Gross, Net
    reportSheet.getRange(2, 6, dataRows, 6).setNumberFormat('$#,##0.00');
  }

  reportSheet.setFrozenRows(1);
  reportSheet.autoResizeColumns(1, HEADERS.length);
  ss.setActiveSheet(reportSheet);

  ui.alert(
    `Done! ${orders.length} order${orders.length !== 1 ? 's' : ''} written for ${startDate} to ${endDate}.`
  );
}

// ── GraphQL ───────────────────────────────────────────────────────────────────

const ORDERS_QUERY = `
  query GetOrders($first: Int!, $after: String, $query: String) {
    orders(first: $first, after: $after, query: $query, sortKey: CREATED_AT) {
      edges {
        node {
          name
          confirmed
          createdAt
          shippingAddress {
            address1
            address2
            city
            province
            zip
            country
          }
          lineItems(first: 100) {
            edges {
              node {
                name
              }
            }
          }
          currentTotalAdditionalFeesSet {
            shopMoney { amount currencyCode }
          }
          currentShippingPriceSet {
            shopMoney { amount currencyCode }
          }
          totalTaxSet {
            shopMoney { amount currencyCode }
          }
          totalDiscountsSet {
            shopMoney { amount currencyCode }
          }
          currentTotalPriceSet {
            shopMoney { amount currencyCode }
          }
          subtotalPriceSet {
            shopMoney { amount currencyCode }
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

function fetchAllOrders(startDate, endDate) {
  const { domain, token, apiVersion } = getCredentials();
  const url = `https://${domain}/admin/api/${apiVersion}/graphql.json`;
  const queryFilter = `created_at:>=${startDate} created_at:<=${endDate}`;

  const allOrders = [];
  let cursor = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const response = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'X-Shopify-Access-Token': token },
      payload: JSON.stringify({
        query: ORDERS_QUERY,
        variables: { first: 50, after: cursor, query: queryFilter },
      }),
      muteHttpExceptions: true,
    });

    if (response.getResponseCode() !== 200) {
      throw new Error(
        `API error (${response.getResponseCode()}): ${response.getContentText()}`
      );
    }

    const json = JSON.parse(response.getContentText());

    if (json.errors) {
      throw new Error(json.errors.map((e) => e.message).join('\n'));
    }

    const ordersData = json.data.orders;
    allOrders.push(...ordersData.edges.map((e) => e.node));

    hasNextPage = ordersData.pageInfo.hasNextPage;
    cursor = ordersData.pageInfo.endCursor;
  }

  return allOrders;
}

// ── Formatters ────────────────────────────────────────────────────────────────

function formatAddress(addr) {
  if (!addr) return '';
  return [addr.address1, addr.address2, addr.city, addr.province, addr.zip, addr.country]
    .filter(Boolean)
    .join(', ');
}

function formatLineItems(lineItems) {
  if (!lineItems || !lineItems.edges || lineItems.edges.length === 0) return '';
  return lineItems.edges.map((e) => e.node.name).join('; ');
}

function moneyAmount(moneySet) {
  if (!moneySet || !moneySet.shopMoney) return 0;
  return parseFloat(moneySet.shopMoney.amount) || 0;
}
