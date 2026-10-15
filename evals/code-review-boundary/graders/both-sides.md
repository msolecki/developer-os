---
type: llm
---
The review reports, as P1 or higher, that listOrders in src/orders-api.js now returns an object with a data array while orderLines in src/orders-client.js still calls .map on the result, and cites a line in each of the two files.
