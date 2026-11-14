import { supabase, handleSupabaseError } from './supabase';
import { isMissingKasaTableError } from './kasaSql';

function isIgnorableTableError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  if (isMissingKasaTableError(err)) return true;
  const e = err as { code?: string; message?: string };
  const msg = (e.message || '').toLowerCase();
  return e.code === '42P01' || e.code === 'PGRST205' || msg.includes('does not exist');
}

export async function deleteUserProfileAccount(
  userId: string
): Promise<{ success: boolean; error?: string; isRls?: boolean }> {
  try {
    await supabase.from('islemler').update({ yapan_user_id: null }).eq('yapan_user_id', userId);
    await supabase.from('gelir_giderler').update({ yapan_user_id: null }).eq('yapan_user_id', userId);

    const { error } = await supabase.from('profiles').delete().eq('id', userId);
    if (error) {
      const msg = handleSupabaseError(error, 'Kullanıcı hesabı silinemedi.');
      const lower = (error.message || '').toLowerCase();
      return {
        success: false,
        error: msg,
        isRls: lower.includes('row-level') || lower.includes('rls') || lower.includes('permission'),
      };
    }
    return { success: true };
  } catch (err: unknown) {
    return {
      success: false,
      error: handleSupabaseError(err, 'Kullanıcı hesabı silinirken hata oluştu.'),
    };
  }
}

export async function deleteFirmaAndAccounts(
  firmaId: string,
  currentUserId?: string
): Promise<{ success: boolean; error?: string; isRls?: boolean }> {
  try {
    // 1. Bağımlı finans ve bildirim kayıtlarını sırayla temizle
    const { error: ggErr } = await supabase.from('gelir_giderler').delete().eq('firma_id', firmaId);
    if (ggErr && !isIgnorableTableError(ggErr)) console.warn('Delete gelir_giderler:', ggErr);

    const { error: kasaErr } = await supabase.from('kasalar').delete().eq('firma_id', firmaId);
    if (kasaErr && !isIgnorableTableError(kasaErr)) console.warn('Delete kasalar:', kasaErr);

    const { error: odemeErr } = await supabase.from('odeme_bildirimleri').delete().eq('firma_id', firmaId);
    if (odemeErr && !isIgnorableTableError(odemeErr)) console.warn('Delete odeme_bildirimleri:', odemeErr);

    await supabase.from('bildirimler').delete().eq('alici_firma_id', firmaId);
    await supabase.from('bildirimler').delete().eq('gonderen_firma_id', firmaId);

    const { error: islemErr } = await supabase.from('islemler').delete().eq('firma_id', firmaId);
    if (islemErr) throw islemErr;

    const { error: fatErr } = await supabase.from('faturalar').delete().eq('firma_id', firmaId);
    if (fatErr && !isIgnorableTableError(fatErr)) console.warn('Delete faturalar:', fatErr);

    const { error: cariErr } = await supabase.from('cariler').delete().eq('firma_id', firmaId);
    if (cariErr) throw cariErr;

    // 2. Kendi profilini silmeden önce diğer profilleri sil (kendi firmasını silen hesapta RLS get_my_firma_id() kopmasın)
    if (currentUserId) {
      const { error: otherProfErr } = await supabase
        .from('profiles')
        .delete()
        .eq('firma_id', firmaId)
        .neq('id', currentUserId);
      if (otherProfErr) throw otherProfErr;

      // Önce firmayı silmeyi dene (ON DELETE CASCADE varsa veya FK yoksa doğrudan temizlenir)
      const { error: firmaFirstErr } = await supabase.from('firmalar').delete().eq('id', firmaId);
      if (!firmaFirstErr) {
        // Kalan kendi profili cascade ile gitmediyse sil
        await supabase.from('profiles').delete().eq('id', currentUserId);
        return { success: true };
      }

      // FK constraint (23503) engel olduysa kendi profilini silip firmayı tekrar sil
      const errCode = (firmaFirstErr as { code?: string }).code;
      if (errCode === '23503' || (firmaFirstErr.message || '').toLowerCase().includes('foreign key')) {
        const { error: selfProfErr } = await supabase.from('profiles').delete().eq('id', currentUserId);
        if (selfProfErr) throw selfProfErr;

        const { error: firmaRetryErr } = await supabase.from('firmalar').delete().eq('id', firmaId);
        if (firmaRetryErr) throw firmaRetryErr;
        return { success: true };
      }

      throw firmaFirstErr;
    }

    // 3. Süper Admin başka firmayı siliyorsa önce tüm firma profillerini sonra firmayı sil
    const { error: profErr } = await supabase.from('profiles').delete().eq('firma_id', firmaId);
    if (profErr) throw profErr;

    const { error: firmaErr } = await supabase.from('firmalar').delete().eq('id', firmaId);
    if (firmaErr) throw firmaErr;

    return { success: true };
  } catch (err: unknown) {
    const raw =
      typeof err === 'object' && err !== null && 'message' in err
        ? String((err as { message: unknown }).message).toLowerCase()
        : '';
    const isRls = raw.includes('row-level') || raw.includes('rls') || raw.includes('permission');
    return {
      success: false,
      isRls,
      error: handleSupabaseError(err, 'Firma ve bağlı hesaplar silinemedi.'),
    };
  }
}
