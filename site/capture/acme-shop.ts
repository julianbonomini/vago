// The invented example Project the site's TUI replays, acme-shop, a small web shop: its Goals and Tickets,
// and what each Ticket's invented Runs touch. Nothing here comes from a real Project; it is made up so the
// frames show no real Goal, log, name or spend.

/** How far an example Ticket got: "replay" is the one the capture plays through its Steps. */
export type ExampleTicketState = "done" | "ready" | "stuck" | "replay";

/** An example Ticket: its file's text, and what its invented Runs read, test and grep for. */
export type ExampleTicket = {
	slug: string;
	title: string;
	what: string;
	criteria: string[];
	/** Numbers of the Tickets it waits for, from 1. */
	blockedBy?: number[];
	files: string[];
	test: string;
	tests: string[];
	grep: string;
	notes: string[];
	state: ExampleTicketState;
};

/** An example Goal: its goal.md text and its Tickets. */
export type ExampleGoal = {
	name: string;
	title: string;
	problem: string;
	solution: string;
	stories: string[];
	out: string;
	state: "done" | "running" | "stuck" | "ready";
	/** Days before the capture the Goal was created; its Runs follow. */
	daysAgo: number;
	tickets: ExampleTicket[];
};

/** The Project's name, its folder's. */
export const exampleProject = "acme-shop";

/** Every Goal of acme-shop. Exactly one is "running", with exactly one Ticket in the "replay" state. */
export const exampleGoals: ExampleGoal[] = [
	{
		name: "gift-cards",
		title: "Customers can pay with a gift card",
		problem:
			"Customers ask for gift cards every December and the shop has nothing to sell them. Staff work around it with discount codes, which can't hold a balance, so a code is either used up in one order or shared around. Nobody can say how much credit is still out there.",
		solution:
			"A gift card is a code with a balance. Customers buy one like any product, spend it at checkout over one or several orders, and check what's left on a page of its own. Staff can issue a card by hand, and a refund on an order paid by card goes back to the card.",
		stories: [
			"As a customer, I want to pay part of an order with a gift card, so that I can spend a small balance.",
			"As a customer, I want to check a card's balance without logging in, so that I know what I can buy.",
			"As staff, I want to issue a card from the admin, so that I can make good on a complaint.",
		],
		out: "Physical cards, expiry dates and cards in other currencies are out of scope.",
		state: "running",
		daysAgo: 0,
		tickets: [
			{
				slug: "01-gift-card-codes",
				title: "A gift card is a code with a balance",
				what: "A `gift_cards` table and a `GiftCard` module that issues a 16-character code with a starting balance, reads a card by its code and takes an amount off it in one transaction. Codes skip easily confused letters.",
				criteria: [
					"A new card's code is 16 characters and never repeats.",
					"Taking more than the balance fails and leaves it unchanged.",
					"`bun run check` passes.",
				],
				files: [
					"src/gift-cards/gift-card.ts",
					"src/db/migrations/0031_gift_cards.sql",
				],
				test: "test/gift-card.test.ts",
				tests: [
					"a new card gets a 16-character code and its starting balance",
					"taking more than the balance fails and keeps it",
					"codes skip 0, O, 1 and I",
				],
				grep: "export function charge",
				notes: [
					"Codes come from `crypto.getRandomValues`, grouped in fours for reading aloud.",
				],
				state: "done",
			},
			{
				slug: "02-redeem-at-checkout",
				title: "Checkout takes a gift card code",
				what: "A gift card field on the payment step. A valid code pays as much of the order as its balance allows, and the card pays for whatever is left. The card is charged in the same transaction that places the order.",
				criteria: [
					"A card with enough balance pays the whole order.",
					"A card with less pays part and the rest goes to the card on file.",
					"An unknown code says so under the field.",
				],
				blockedBy: [1],
				files: ["src/checkout/payment-step.tsx", "src/checkout/place-order.ts"],
				test: "test/checkout-gift-card.test.ts",
				tests: [
					"a card with enough balance pays the whole order",
					"a smaller balance pays part and the card pays the rest",
					"an unknown code shows an error under the field",
				],
				grep: "placeOrder(",
				notes: [
					"The order and the card charge share one transaction, so a failed payment refunds nothing by hand.",
				],
				state: "done",
			},
			{
				slug: "03-balance-page",
				title: "Customers can check a card's balance",
				what: "A page at `/gift-cards/balance` where anyone types a code and sees its balance and its last five uses. It doesn't need an account. Five wrong codes from one address in ten minutes slow the next try down.",
				criteria: [
					"A valid code shows its balance and its last five uses.",
					"A wrong code says it wasn't found, never whether it once existed.",
					"Repeated wrong codes are rate limited.",
					"`bun run check` passes.",
				],
				blockedBy: [1],
				files: [
					"src/routes/gift-cards/balance.tsx",
					"src/gift-cards/balance-lookup.ts",
					"src/http/rate-limit.ts",
				],
				test: "test/gift-card-balance.test.ts",
				tests: [
					"a valid code shows its balance and its last five uses",
					"a wrong code says not found",
					"the sixth wrong code in ten minutes waits",
					"the page needs no account",
				],
				grep: "rateLimit(",
				notes: [
					"The rate limit reuses the login form's limiter with its own key.",
				],
				state: "replay",
			},
			{
				slug: "04-staff-issue-cards",
				title: "Staff issue gift cards from the admin",
				what: "An Issue gift card form in the admin: an amount, an optional note, and the new code shown once with a copy button. Each issued card is logged with who issued it.",
				criteria: [
					"Only staff see the form.",
					"The code shows once and is logged with the staff member's name.",
				],
				blockedBy: [1],
				files: [
					"src/admin/gift-cards/issue-form.tsx",
					"src/admin/audit-log.ts",
				],
				test: "test/admin-issue-gift-card.test.ts",
				tests: ["staff can issue a card", "customers can't reach the form"],
				grep: "auditLog.write",
				notes: [],
				state: "ready",
			},
			{
				slug: "05-refunds-to-card",
				title: "A refund on a gift card order goes back to the card",
				what: "Refunding an order that a gift card paid for puts the card's share back on the card, and the rest back on the payment card, in that order.",
				criteria: [
					"A full refund restores the card's balance.",
					"A partial refund fills the gift card first.",
				],
				blockedBy: [2],
				files: ["src/orders/refund.ts"],
				test: "test/refund-gift-card.test.ts",
				tests: [
					"a full refund restores the card's balance",
					"a partial refund fills the gift card first",
				],
				grep: "export async function refund",
				notes: [],
				state: "ready",
			},
		],
	},
	{
		name: "order-export",
		title: "Store owners can export orders as a spreadsheet",
		problem:
			"At the end of each month the owner copies orders out of the admin by hand to send to the accountant. It takes an afternoon and the totals rarely match the payment provider's.",
		solution:
			"An Export button on the orders page downloads the orders shown as a CSV file, with one row per order and the columns an accountant asks for. A date range picks which orders go in.",
		stories: [
			"As an owner, I want last month's orders in a spreadsheet, so that I can send them to my accountant.",
			"As an owner, I want amounts in their own columns, so that the sums add up.",
		],
		out: "Scheduled exports and Excel files are out of scope.",
		state: "stuck",
		daysAgo: 2,
		tickets: [
			{
				slug: "01-export-button",
				title: "The orders page exports what it shows as CSV",
				what: "An Export button next to the orders filter. It downloads the orders the page currently lists as `orders.csv`, one row per order.",
				criteria: [
					"The file has a header row and one row per listed order.",
					"Commas and quotes in names are escaped.",
				],
				files: [
					"src/admin/orders/export.ts",
					"src/admin/orders/orders-page.tsx",
				],
				test: "test/order-export.test.ts",
				tests: [
					"the export has a header and one row per order",
					"a comma in a customer's name is quoted",
				],
				grep: "listOrders(",
				notes: [],
				state: "done",
			},
			{
				slug: "02-date-range-filter",
				title: "A date range picks which orders are exported",
				what: "From and to dates on the orders filter, in the shop's time zone. The export and the list both follow them.",
				criteria: [
					"An order placed at 23:30 on the last day is included.",
					"The range survives a page reload.",
				],
				blockedBy: [1],
				files: [
					"src/admin/orders/date-range.tsx",
					"src/admin/orders/list-orders.ts",
				],
				test: "test/order-date-range.test.ts",
				tests: [
					"an order at 23:30 on the last day is included",
					"the range is kept in the URL",
				],
				grep: "timeZone",
				notes: [],
				state: "stuck",
			},
			{
				slug: "03-currency-columns",
				title: "Amounts are exported as numbers with their currency apart",
				what: "Subtotal, tax, shipping, discount and total each get a column of plain numbers, and the currency code a column of its own.",
				criteria: ["A spreadsheet can sum every amount column."],
				blockedBy: [2],
				files: ["src/admin/orders/export.ts"],
				test: "test/order-export.test.ts",
				tests: ["amounts are plain numbers"],
				grep: "formatMoney",
				notes: [],
				state: "ready",
			},
		],
	},
	{
		name: "dark-mode",
		title: "The storefront follows the system's dark mode",
		problem:
			"The storefront is white at night. Customers on phones in dark mode get a bright screen and product photos with white boxes around them.",
		solution:
			"The storefront's colours become tokens with a light and a dark value, chosen by the system setting, with a toggle in the footer that remembers a customer's choice.",
		stories: [
			"As a customer browsing at night, I want the shop to be dark when my phone is, so that it doesn't glare.",
		],
		out: "The admin stays light.",
		state: "ready",
		daysAgo: 1,
		tickets: [
			{
				slug: "01-colour-tokens",
				title: "Storefront colours come from tokens",
				what: "Every colour in the storefront's styles reads a CSS custom property with a light and a dark value.",
				criteria: ["No literal colour is left in the storefront's styles."],
				files: ["src/styles/tokens.css"],
				test: "test/styles.test.ts",
				tests: ["no literal colours"],
				grep: "#fff",
				notes: [],
				state: "ready",
			},
			{
				slug: "02-product-images-on-dark",
				title: "Product photos sit on a dark ground without white boxes",
				what: "Product photos with a white background get a soft light card behind them in dark mode.",
				criteria: ["No photo shows a white box on a dark page."],
				blockedBy: [1],
				files: ["src/components/product-image.tsx"],
				test: "test/product-image.test.ts",
				tests: ["photos get a card in dark mode"],
				grep: "ProductImage",
				notes: [],
				state: "ready",
			},
			{
				slug: "03-theme-toggle",
				title: "A footer toggle overrides the system setting",
				what: "Light, dark and system in the footer, remembered per browser.",
				criteria: ["The choice survives a reload."],
				blockedBy: [1],
				files: ["src/components/footer.tsx"],
				test: "test/theme-toggle.test.ts",
				tests: ["the choice survives a reload"],
				grep: "Footer",
				notes: [],
				state: "ready",
			},
		],
	},
	{
		name: "search-typos",
		title: "Product search finds items despite typos",
		problem:
			'Searching for "sneekers" or "t shirt" finds nothing, and about one search in eight ends on an empty page. Those customers mostly leave.',
		solution:
			"Search matches words within one or two typos, ranks exact matches first, and when it still finds nothing it suggests the closest product name.",
		stories: [
			"As a customer, I want to find sneakers when I type sneekers, so that a typo doesn't end my visit.",
		],
		out: "Search in other languages and synonyms are out of scope.",
		state: "done",
		daysAgo: 9,
		tickets: [
			{
				slug: "01-fuzzy-match",
				title: "Search matches words within two typos",
				what: "Product search tolerates one typo in words of four to seven letters and two in longer ones, using the database's trigram index.",
				criteria: [
					'"sneekers" finds sneakers.',
					"Short words still need an exact match.",
				],
				files: [
					"src/search/search-products.ts",
					"src/db/migrations/0027_trigram_index.sql",
				],
				test: "test/search.test.ts",
				tests: [
					"sneekers finds sneakers",
					"a three-letter word needs an exact match",
				],
				grep: "searchProducts(",
				notes: [],
				state: "done",
			},
			{
				slug: "02-ranking",
				title: "Exact matches rank above near ones",
				what: "Results are ordered by how close the match is, then by sales in the last 30 days.",
				criteria: ["An exact name match is always first."],
				blockedBy: [1],
				files: ["src/search/rank.ts"],
				test: "test/search-ranking.test.ts",
				tests: ["an exact match comes first", "ties go to the better seller"],
				grep: "similarity",
				notes: [],
				state: "done",
			},
			{
				slug: "03-did-you-mean",
				title: "An empty search suggests the closest product name",
				what: "When a search finds nothing, the page offers the closest product name as a link.",
				criteria: ["The suggestion is a real product name."],
				blockedBy: [1],
				files: ["src/routes/search.tsx"],
				test: "test/search-suggestion.test.ts",
				tests: ["an empty search suggests the closest name"],
				grep: "NoResults",
				notes: [],
				state: "done",
			},
			{
				slug: "04-search-docs",
				title: "The admin guide explains how search matches",
				what: "A section in the admin guide on what search tolerates and how results are ordered.",
				criteria: ["The guide's examples run as written."],
				blockedBy: [2, 3],
				files: ["docs/admin/search.md"],
				test: "test/docs.test.ts",
				tests: ["the guide's examples run"],
				grep: "## Search",
				notes: [],
				state: "done",
			},
		],
	},
	{
		name: "low-stock-email",
		title: "Owners get an email before stock runs out",
		problem:
			"Popular products sell out before anyone notices, and the shop finds out from customers.",
		solution:
			"Each product gets a low-stock threshold. Once a day the shop emails the owner every product at or under it.",
		stories: [
			"As an owner, I want one email a day listing what's running low, so that I can reorder in time.",
		],
		out: "Automatic reordering is out of scope.",
		state: "done",
		daysAgo: 6,
		tickets: [
			{
				slug: "01-threshold-setting",
				title: "Each product has a low-stock threshold",
				what: "A threshold field on the product form, defaulting to five.",
				criteria: ["New products start at five."],
				files: ["src/admin/products/product-form.tsx"],
				test: "test/product-form.test.ts",
				tests: ["new products start at five"],
				grep: "stock",
				notes: [],
				state: "done",
			},
			{
				slug: "02-daily-check",
				title: "A daily job finds products at or under their threshold",
				what: "A job at 07:00 shop time collects every product at or under its threshold.",
				criteria: ["A product at its threshold is included."],
				blockedBy: [1],
				files: ["src/jobs/low-stock.ts"],
				test: "test/low-stock-job.test.ts",
				tests: [
					"a product at its threshold is included",
					"a product above it isn't",
				],
				grep: "schedule(",
				notes: [],
				state: "done",
			},
			{
				slug: "03-email-template",
				title: "The owner gets one email listing them",
				what: "One email with a table of the products, their stock and a link to each.",
				criteria: ["No email is sent when nothing is low."],
				blockedBy: [2],
				files: ["src/email/low-stock.tsx"],
				test: "test/low-stock-email.test.ts",
				tests: ["no email when nothing is low"],
				grep: "sendEmail(",
				notes: [],
				state: "done",
			},
		],
	},
	{
		name: "responsive-images",
		title: "Product images load at the size they're shown",
		problem:
			"The category pages load every product photo at full size. On a phone a page of twenty products downloads 38 MB.",
		solution:
			"Uploads are resized to four widths, pages ask for the width they show, and photos below the fold load as they scroll in.",
		stories: [
			"As a customer on a phone, I want category pages to load quickly, so that I don't give up.",
		],
		out: "Changing the image host is out of scope.",
		state: "done",
		daysAgo: 12,
		tickets: [
			{
				slug: "01-image-sizes",
				title: "Uploads are resized to four widths",
				what: "On upload, each photo is saved at 320, 640, 1024 and 1600 pixels wide as WebP.",
				criteria: ["A photo smaller than a width isn't scaled up."],
				files: ["src/images/resize.ts"],
				test: "test/resize.test.ts",
				tests: ["four widths are saved", "a small photo isn't scaled up"],
				grep: "sharp(",
				notes: [],
				state: "done",
			},
			{
				slug: "02-srcset",
				title: "Product images ask for the width they show",
				what: "Product images use `srcset` and `sizes` from the layout they sit in.",
				criteria: ["A phone loads the 640 width on a category page."],
				blockedBy: [1],
				files: ["src/components/product-image.tsx"],
				test: "test/product-image.test.ts",
				tests: ["the category page asks for 640 on a phone"],
				grep: "<img",
				notes: [],
				state: "done",
			},
			{
				slug: "03-lazy-below-fold",
				title: "Photos below the fold load as they scroll in",
				what: "Every product photo after the first row is loaded lazily.",
				criteria: ["The first row loads eagerly."],
				blockedBy: [2],
				files: ["src/routes/category.tsx"],
				test: "test/category.test.ts",
				tests: ["the first row loads eagerly"],
				grep: "loading=",
				notes: [],
				state: "done",
			},
		],
	},
	{
		name: "saved-addresses",
		title: "Returning customers pick a saved address at checkout",
		problem:
			"Logged-in customers type their address on every order, and one order in fifty ships with a typo in it.",
		solution:
			"Customers keep an address book. Checkout offers its addresses, with the default one picked, and a new address can be saved from checkout.",
		stories: [
			"As a returning customer, I want my address filled in, so that checking out takes a minute.",
		],
		out: "Address validation against a postal service is out of scope.",
		state: "done",
		daysAgo: 15,
		tickets: [
			{
				slug: "01-address-book",
				title: "Customers keep an address book",
				what: "An Addresses page in the account where customers add, edit and remove addresses.",
				criteria: ["A customer sees only their own addresses."],
				files: ["src/routes/account/addresses.tsx"],
				test: "test/address-book.test.ts",
				tests: ["a customer sees only their own addresses"],
				grep: "Address",
				notes: [],
				state: "done",
			},
			{
				slug: "02-checkout-picker",
				title: "Checkout offers the saved addresses",
				what: "The shipping step lists saved addresses to pick from, with a link to add another.",
				criteria: ["Picking an address fills the shipping step."],
				blockedBy: [1],
				files: ["src/checkout/shipping-step.tsx"],
				test: "test/checkout-addresses.test.ts",
				tests: ["picking an address fills the step"],
				grep: "ShippingStep",
				notes: [],
				state: "done",
			},
			{
				slug: "03-default-address",
				title: "The default address is picked first",
				what: "Customers mark one address as the default, and checkout starts with it picked.",
				criteria: ["Exactly one address is the default."],
				blockedBy: [1, 2],
				files: ["src/routes/account/addresses.tsx"],
				test: "test/address-book.test.ts",
				tests: ["exactly one default"],
				grep: "isDefault",
				notes: [],
				state: "done",
			},
		],
	},
];

/** acme-shop's planning item: a Goal still being planned in the TUI, its agent's Proposal ready to accept. */
export type ExamplePlanningItem = {
	name: string;
	/** The proposed `goal.md` and Tickets, as the agent's proposal block writes them. */
	goal: string;
	tickets: { slug: string; blockedBy: number[]; body: string }[];
	workflow: string;
	workflowReason: string;
	/** The planning session's past runs: how many minutes before the capture each began and ended, and what
	 *  its Harness session had cost by then. */
	sessions: { startedAgo: number; endedAgo: number; cost: number }[];
	/** What the planning session shows in its pane, line by line: the human's messages and the agent's. */
	transcript: string[];
};

export const examplePlanningItem: ExamplePlanningItem = {
	name: "self-service-returns",
	goal: `# Customers start a return themselves

## Problem Statement

Customers email support to return an item, and staff copy each email into the admin by hand.

## Solution

An order's page gets a Return button. The customer picks the items and a reason, staff approve the return in the admin, and the refund goes through \`refundOrder\` as it does today.

## Out of Scope

Shipping labels and exchanges.
`,
	tickets: [
		{
			slug: "return-requests",
			blockedBy: [],
			body: "# A customer requests a return\n\nThe order page's Return button opens a form of the order's items and a reason.\n",
		},
		{
			slug: "staff-approval",
			blockedBy: [1],
			body: "# Staff approve or decline a return\n\nThe admin lists open returns; approving one refunds its items.\n",
		},
		{
			slug: "return-emails",
			blockedBy: [2],
			body: "# The customer hears back by email\n\nAn email when the return is approved or declined.\n",
		},
	],
	workflow: "small",
	workflowReason:
		"Three small Tickets on code that has tests; refunds already go through one function.",
	sessions: [{ startedAgo: 50, endedAgo: 8, cost: 0.64 }],
	transcript: [
		"> Customers email us to return things, and staff type",
		"  each one into the admin. I want customers to start a",
		"  return from their order page.",
		"",
		"● I read src/orders/ and src/admin/refunds.ts. Refunds",
		"  already go through refundOrder(), so an approved",
		"  return can end there. Two decisions are still open:",
		"",
		"  1. Does staff approve each return before its refund?",
		"  2. Can a customer return some of an order's items?",
		"",
		"> Staff approve every return. Yes, per item.",
		"",
		"● Then the Goal is three Tickets: the request, staff",
		"  approval, and the emails, on the small Workflow. The",
		"  Proposal is in the Preview; accept it there when it",
		"  reads right.",
	],
};
