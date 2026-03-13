import type { Piece } from './types';
import { supabase } from './lib/supabaseClient';

const TABLE_NAME = 'pieces';

type PieceRow = {
  id: string;
  payload: Piece;
};

export async function loadPieces(): Promise<Piece[]> {
  const { data, error } = await supabase
    .from(TABLE_NAME)
    .select('id, payload')
    .order('created_at', { ascending: false });

  if (error || !data) {
    return [];
  }

  return (data as PieceRow[]).map((row) => ({
    ...row.payload,
    id: row.id,
  }));
}

export async function addPiece(piece: Piece): Promise<Piece[]> {
  const { error } = await supabase.from(TABLE_NAME).insert({
    id: piece.id,
    payload: piece,
  });

  if (error) {
    return loadPieces();
  }

  return loadPieces();
}

export async function updatePiece(
  id: string,
  updates: Partial<Piece>
): Promise<Piece[]> {
  const existing = await getPieceById(id);
  if (!existing) {
    return loadPieces();
  }

  const updated: Piece = { ...existing, ...updates };

  const { error } = await supabase
    .from(TABLE_NAME)
    .update({ payload: updated })
    .eq('id', id);

  if (error) {
    return loadPieces();
  }

  return loadPieces();
}

export async function deletePiece(id: string): Promise<Piece[]> {
  const { error } = await supabase.from(TABLE_NAME).delete().eq('id', id);

  if (error) {
    return loadPieces();
  }

  return loadPieces();
}

export async function getPieceById(id: string): Promise<Piece | null> {
  const { data, error } = await supabase
    .from(TABLE_NAME)
    .select('id, payload')
    .eq('id', id)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  const row = data as PieceRow;
  return {
    ...row.payload,
    id: row.id,
  };
}
