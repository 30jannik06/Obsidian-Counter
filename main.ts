import { App, ItemView, Plugin, WorkspaceLeaf, Modal, Setting, Notice, TFile } from "obsidian";

const VIEW_TYPE_COUNTER = "counter-view";

type CounterMode = "manual" | "auto";
type AutoMetric = "notes" | "links" | "tags" | "attachments" | "streak";

const AUTO_METRIC_LABELS: Record<AutoMetric, string> = {
	notes: "Notes in vault",
	links: "Links in vault",
	tags: "Tags used (total)",
	attachments: "Attachments in vault",
	streak: "Day streak (notes created)",
};

interface CounterItem {
	id: string;
	name: string;
	count: number;
	step: number;
	mode: CounterMode;
	metric?: AutoMetric;
}

interface CounterPluginSettings {
	counters: CounterItem[];
}

const DEFAULT_SETTINGS: CounterPluginSettings = {
	counters: [],
};

function makeId(): string {
	return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function computeAutoValue(app: App, metric: AutoMetric | undefined): number {
	switch (metric) {
		case "notes":
			return app.vault.getMarkdownFiles().length;
		case "links": {
			const resolved = app.metadataCache.resolvedLinks;
			let total = 0;
			for (const target of Object.values(resolved)) {
				for (const count of Object.values(target)) {
					total += count;
				}
			}
			return total;
		}
		case "tags": {
			const cache = app.metadataCache as unknown as { getTags?: () => Record<string, number> };
			const tags = cache.getTags ? cache.getTags() : {};
			return Object.values(tags).reduce((sum, n) => sum + n, 0);
		}
		case "attachments": {
			const all = app.vault.getFiles().filter((f): f is TFile => f instanceof TFile);
			return all.length - app.vault.getMarkdownFiles().length;
		}
		case "streak": {
			const days = new Set<string>();
			for (const file of app.vault.getMarkdownFiles()) {
				days.add(new Date(file.stat.ctime).toDateString());
			}
			const cursor = new Date();
			cursor.setHours(0, 0, 0, 0);
			if (!days.has(cursor.toDateString())) {
				// Today has no new note yet - that alone shouldn't break the streak.
				cursor.setDate(cursor.getDate() - 1);
			}
			let streak = 0;
			while (days.has(cursor.toDateString())) {
				streak++;
				cursor.setDate(cursor.getDate() - 1);
			}
			return streak;
		}
		default:
			return 0;
	}
}

class NameModal extends Modal {
	private onSubmit: (name: string) => void;
	private value: string;

	constructor(app: App, defaultValue: string, title: string, onSubmit: (name: string) => void) {
		super(app);
		this.value = defaultValue;
		this.onSubmit = onSubmit;
		this.titleEl.setText(title);
	}

	onOpen() {
		const { contentEl } = this;
		let inputEl: HTMLInputElement;

		new Setting(contentEl).setName("Name").addText((text) => {
			inputEl = text.inputEl;
			text.setValue(this.value).onChange((v) => (this.value = v));
			window.setTimeout(() => {
				text.inputEl.focus();
				text.inputEl.select();
			}, 0);
		});

		inputEl = contentEl.querySelector("input") as HTMLInputElement;
		inputEl?.addEventListener("keydown", (evt) => {
			if (evt.key === "Enter") {
				evt.preventDefault();
				this.submit();
			}
		});

		new Setting(contentEl).addButton((btn) =>
			btn
				.setButtonText("Save")
				.setCta()
				.onClick(() => this.submit())
		);
	}

	private submit() {
		const trimmed = this.value.trim();
		if (trimmed.length === 0) {
			new Notice("Name cannot be empty");
			return;
		}
		this.onSubmit(trimmed);
		this.close();
	}

	onClose() {
		this.contentEl.empty();
	}
}

interface NewCounterResult {
	name: string;
	mode: CounterMode;
	metric: AutoMetric;
}

class NewCounterModal extends Modal {
	private onSubmit: (result: NewCounterResult) => void;
	private name = "";
	private mode: CounterMode = "manual";
	private metric: AutoMetric = "notes";
	private metricSettingEl: Setting | null = null;

	constructor(app: App, onSubmit: (result: NewCounterResult) => void) {
		super(app);
		this.onSubmit = onSubmit;
		this.titleEl.setText("New counter");
	}

	onOpen() {
		const { contentEl } = this;

		let nameInput: HTMLInputElement;
		new Setting(contentEl).setName("Name").addText((text) => {
			nameInput = text.inputEl;
			text.onChange((v) => (this.name = v));
			window.setTimeout(() => text.inputEl.focus(), 0);
		});

		new Setting(contentEl)
			.setName("Type")
			.setDesc("Manual: you click +/−. Automatic: tracks a live vault stat.")
			.addDropdown((dd) => {
				dd.addOption("manual", "Manual (tap counter)");
				dd.addOption("auto", "Automatic (vault stat)");
				dd.setValue(this.mode);
				dd.onChange((v) => {
					this.mode = v as CounterMode;
					this.updateMetricVisibility();
				});
			});

		this.metricSettingEl = new Setting(contentEl).setName("Tracks").addDropdown((dd) => {
			for (const [value, label] of Object.entries(AUTO_METRIC_LABELS)) {
				dd.addOption(value, label);
			}
			dd.setValue(this.metric);
			dd.onChange((v) => (this.metric = v as AutoMetric));
		});
		this.updateMetricVisibility();

		new Setting(contentEl).addButton((btn) =>
			btn
				.setButtonText("Add")
				.setCta()
				.onClick(() => this.submit())
		);

		nameInput = contentEl.querySelector("input") as HTMLInputElement;
		nameInput?.addEventListener("keydown", (evt) => {
			if (evt.key === "Enter") {
				evt.preventDefault();
				this.submit();
			}
		});
	}

	private updateMetricVisibility() {
		this.metricSettingEl?.settingEl.toggleClass("counter-hidden", this.mode !== "auto");
	}

	private submit() {
		const trimmed = this.name.trim();
		if (trimmed.length === 0) {
			new Notice("Name cannot be empty");
			return;
		}
		this.onSubmit({ name: trimmed, mode: this.mode, metric: this.metric });
		this.close();
	}

	onClose() {
		this.contentEl.empty();
	}
}

class CounterView extends ItemView {
	plugin: CounterPlugin;

	constructor(leaf: WorkspaceLeaf, plugin: CounterPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_COUNTER;
	}

	getDisplayText(): string {
		return "Counters";
	}

	getIcon(): string {
		return "plus-circle";
	}

	async onOpen() {
		this.render();
	}

	async onClose() {
		this.contentEl.empty();
	}

	render() {
		const container = this.contentEl;
		container.empty();
		container.addClass("counter-view-container");

		const header = container.createDiv({ cls: "counter-view-header" });
		header.createEl("h4", { text: "Counters" });
		const addBtn = header.createEl("button", { cls: "counter-add-btn", text: "+ Add counter" });
		addBtn.addEventListener("click", () => {
			new NewCounterModal(this.app, async ({ name, mode, metric }) => {
				const newCounter: CounterItem = { id: makeId(), name, count: 0, step: 1, mode };
				if (mode === "auto") newCounter.metric = metric;
				this.plugin.settings.counters.push(newCounter);
				await this.plugin.saveSettings();
				this.render();
			}).open();
		});

		const list = container.createDiv({ cls: "counter-list" });

		if (this.plugin.settings.counters.length === 0) {
			list.createDiv({ cls: "counter-empty", text: "No counters yet. Add one to start counting." });
			return;
		}

		for (const counter of this.plugin.settings.counters) {
			this.renderCounterCard(list, counter);
		}
	}

	makeDraggable(card: HTMLElement, counter: CounterItem) {
		card.setAttribute("draggable", "true");

		card.addEventListener("dragstart", (evt) => {
			evt.dataTransfer?.setData("text/plain", counter.id);
			card.addClass("counter-dragging");
		});

		card.addEventListener("dragend", () => {
			card.removeClass("counter-dragging");
		});

		card.addEventListener("dragover", (evt) => {
			evt.preventDefault();
			card.addClass("counter-drag-over");
		});

		card.addEventListener("dragleave", () => {
			card.removeClass("counter-drag-over");
		});

		card.addEventListener("drop", async (evt) => {
			evt.preventDefault();
			card.removeClass("counter-drag-over");
			const draggedId = evt.dataTransfer?.getData("text/plain");
			if (!draggedId || draggedId === counter.id) return;

			const counters = this.plugin.settings.counters;
			const fromIndex = counters.findIndex((c) => c.id === draggedId);
			const toIndex = counters.findIndex((c) => c.id === counter.id);
			if (fromIndex === -1 || toIndex === -1) return;

			const [moved] = counters.splice(fromIndex, 1);
			counters.splice(toIndex, 0, moved);
			await this.plugin.saveSettings();
			this.render();
		});
	}

	renderCounterCard(parent: HTMLElement, counter: CounterItem) {
		const card = parent.createDiv({ cls: "counter-card" });
		if (counter.mode === "auto") card.addClass("counter-card-auto");
		this.makeDraggable(card, counter);

		const titleRow = card.createDiv({ cls: "counter-card-title-row" });
		const dragHandle = titleRow.createEl("span", { cls: "counter-drag-handle", text: "⠿" });
		dragHandle.setAttribute("aria-label", "Drag to reorder");
		const title = titleRow.createEl("span", { cls: "counter-card-title", text: counter.name });
		title.addEventListener("click", () => {
			new NameModal(this.app, counter.name, "Rename counter", async (name) => {
				counter.name = name;
				await this.plugin.saveSettings();
				this.render();
			}).open();
		});

		const deleteBtn = titleRow.createEl("button", { cls: "counter-icon-btn counter-delete-btn", text: "✕" });
		deleteBtn.setAttribute("aria-label", "Delete counter");
		deleteBtn.addEventListener("click", async () => {
			this.plugin.settings.counters = this.plugin.settings.counters.filter((c) => c.id !== counter.id);
			await this.plugin.saveSettings();
			this.render();
		});

		if (counter.mode === "auto") {
			card.createDiv({ cls: "counter-auto-badge", text: AUTO_METRIC_LABELS[counter.metric ?? "notes"] });
		}

		const countRow = card.createDiv({ cls: "counter-count-row" });
		const liveValue = counter.mode === "auto" ? computeAutoValue(this.app, counter.metric) : counter.count;
		const countDisplay = countRow.createEl("span", { cls: "counter-count-display", text: String(liveValue) });

		if (counter.mode === "auto") {
			return;
		}

		const btnRow = card.createDiv({ cls: "counter-btn-row" });

		const minusBtn = btnRow.createEl("button", { cls: "counter-btn counter-minus-btn", text: "−" });
		minusBtn.addEventListener("click", async () => {
			counter.count -= counter.step;
			countDisplay.setText(String(counter.count));
			await this.plugin.saveSettings();
		});

		const plusBtn = btnRow.createEl("button", { cls: "counter-btn counter-plus-btn", text: "+" });
		plusBtn.addEventListener("click", async () => {
			counter.count += counter.step;
			countDisplay.setText(String(counter.count));
			await this.plugin.saveSettings();
		});

		const resetBtn = btnRow.createEl("button", { cls: "counter-btn counter-reset-btn", text: "⟲" });
		resetBtn.setAttribute("aria-label", "Reset to 0");
		resetBtn.addEventListener("click", async () => {
			counter.count = 0;
			countDisplay.setText(String(counter.count));
			await this.plugin.saveSettings();
		});

		const stepRow = card.createDiv({ cls: "counter-step-row" });
		stepRow.createEl("span", { cls: "counter-step-label", text: "Step" });
		const stepInput = stepRow.createEl("input", { cls: "counter-step-input", type: "number" }) as HTMLInputElement;
		stepInput.value = String(counter.step);
		stepInput.addEventListener("change", async () => {
			const parsed = parseInt(stepInput.value, 10);
			counter.step = Number.isFinite(parsed) && parsed !== 0 ? parsed : 1;
			stepInput.value = String(counter.step);
			await this.plugin.saveSettings();
		});
	}
}

export default class CounterPlugin extends Plugin {
	settings: CounterPluginSettings;

	async onload() {
		await this.loadSettings();

		this.registerView(VIEW_TYPE_COUNTER, (leaf) => new CounterView(leaf, this));

		this.addRibbonIcon("plus-circle", "Open counters", () => {
			this.activateView();
		});

		this.addCommand({
			id: "open-counter-view",
			name: "Open counters panel",
			callback: () => this.activateView(),
		});

		this.addCommand({
			id: "add-counter",
			name: "Add new counter",
			callback: () => {
				new NewCounterModal(this.app, async ({ name, mode, metric }) => {
					const newCounter: CounterItem = { id: makeId(), name, count: 0, step: 1, mode };
					if (mode === "auto") newCounter.metric = metric;
					this.settings.counters.push(newCounter);
					await this.saveSettings();
				}).open();
			},
		});

		// Keep automatic counters live without persisting on every vault change.
		const refresh = () => this.refreshViews();
		this.registerEvent(this.app.vault.on("create", refresh));
		this.registerEvent(this.app.vault.on("delete", refresh));
		this.registerEvent(this.app.vault.on("rename", refresh));
		this.registerEvent(this.app.metadataCache.on("resolved", refresh));
	}

	onunload() {}

	async activateView() {
		const { workspace } = this.app;
		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType(VIEW_TYPE_COUNTER);

		if (leaves.length > 0) {
			leaf = leaves[0];
		} else {
			leaf = workspace.getRightLeaf(false);
			await leaf?.setViewState({ type: VIEW_TYPE_COUNTER, active: true });
		}

		if (leaf) {
			workspace.revealLeaf(leaf);
		}
	}

	refreshViews() {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_COUNTER)) {
			if (leaf.view instanceof CounterView) {
				leaf.view.render();
			}
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
		for (const counter of this.settings.counters) {
			if (!counter.mode) counter.mode = "manual";
		}
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.refreshViews();
	}
}
