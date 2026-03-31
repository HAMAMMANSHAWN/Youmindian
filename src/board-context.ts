import { type Board, type BoardContextState, YouMindAPI, invalidateBoardCache } from './api';
import type { BoardChangeListener } from './types';

export class BoardContext {
	private state: BoardContextState = {
		currentBoard: null,
		boards: [],
		isLoading: false,
		error: null,
	};

	private listeners = new Set<BoardChangeListener>();
	private initializePromise: Promise<void> | null = null;
	private destroyed = false;

	constructor(
		private api: YouMindAPI,
		private getApiKey: () => string,
		private persistBoardId: (boardId: string | null) => Promise<void>,
		private loadPersistedBoardId: () => string | null,
	) {}

	initialize(): Promise<void> {
		if (!this.initializePromise) {
			this.initializePromise = this.initializeInternal().finally(() => {
				this.initializePromise = null;
			});
		}
		return this.initializePromise;
	}

	private async initializeInternal(): Promise<void> {
		if (this.destroyed) {
			return;
		}

		const apiKey = this.getApiKey().trim();
		if (!apiKey) {
			this.state = {
				currentBoard: null,
				boards: [],
				isLoading: false,
				error: 'Please set your YouMind API key in settings.',
			};
			this.emit();
			return;
		}

		this.state = { ...this.state, isLoading: true, error: null };
		this.emit();

		try {
			const boards = await this.api.listBoards(true);
			let currentBoard: Board | null = null;
			const persistedBoardId = this.loadPersistedBoardId();

			if (persistedBoardId) {
				currentBoard = boards.find((board) => board.id === persistedBoardId) ?? null;
			}

			if (!currentBoard) {
				const defaultBoard = await this.api.getDefaultBoard(true);
				if (defaultBoard) {
					currentBoard = boards.find((board) => board.id === defaultBoard.id) ?? defaultBoard;
				}
			}

			if (!currentBoard && boards.length > 0) {
				currentBoard = boards[0] ?? null;
			}

			this.state = {
				currentBoard,
				boards,
				isLoading: false,
				error: null,
			};

			await this.persistBoardId(currentBoard?.id ?? null);
		} catch (error) {
			this.state = {
				currentBoard: null,
				boards: [],
				isLoading: false,
				error: error instanceof Error ? error.message : 'Failed to load boards.',
			};
		}

		this.emit();
	}

	async refresh(): Promise<void> {
		invalidateBoardCache();
		const previousBoardId = this.state.currentBoard?.id ?? null;
		this.state = { ...this.state, isLoading: true, error: null };
		this.emit();

		try {
			const boards = await this.api.listBoards(true);
			let nextBoard =
				(previousBoardId ? boards.find((board) => board.id === previousBoardId) : null) ??
				null;

			if (!nextBoard) {
				const defaultBoard = await this.api.getDefaultBoard(true);
				if (defaultBoard) {
					nextBoard = boards.find((board) => board.id === defaultBoard.id) ?? defaultBoard;
				}
			}

			if (!nextBoard && boards.length > 0) {
				nextBoard = boards[0] ?? null;
			}

			this.state = {
				currentBoard: nextBoard,
				boards,
				isLoading: false,
				error: null,
			};
			await this.persistBoardId(nextBoard?.id ?? null);
		} catch (error) {
			this.state = {
				...this.state,
				isLoading: false,
				error: error instanceof Error ? error.message : 'Failed to refresh boards.',
			};
		}

		this.emit();
	}

	async setBoard(board: Board | null): Promise<void> {
		this.state = {
			...this.state,
			currentBoard: board,
			error: null,
		};
		await this.persistBoardId(board?.id ?? null);
		this.emit();
	}

	getBoard(): Board | null {
		return this.state.currentBoard;
	}

	getBoardId(): string | null {
		return this.state.currentBoard?.id ?? null;
	}

	getBoards(): Board[] {
		return this.state.boards;
	}

	getIsLoading(): boolean {
		return this.state.isLoading;
	}

	getError(): string | null {
		return this.state.error;
	}

	onChange(listener: BoardChangeListener): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	destroy(): void {
		this.destroyed = true;
		this.listeners.clear();
	}

	private emit(): void {
		const currentBoard = this.state.currentBoard;
		for (const listener of this.listeners) {
			listener(currentBoard);
		}
	}
}
