// User-requested display rule: hide confirmed revoke placeholders, never guess neighbors.
export function isWithdrawnMessage(row) {
  if(row.recalled===true||row.withdrawn===true||['recalled','withdrawn','revoked'].includes(row.status))return true;
  const text=String(row.body??row.content??row.text??'').trim();
  if(/^\[?(?:此|该|这条)?消息已(?:被)?撤回\]?[。.!！]?$/.test(text))return true;
  const system=row.speaker==='系统提示'||row.sender==='系统提示'||row.type===10000||row.base_type===10000;
  return system&&(/撤回(?:了)?(?:一条|该条|这条)?消息/.test(text)||/<sysmsg[^>]*type=["']revokemsg["']/.test(text));
}
export function filterReference(document) {
  const rows=document.paragraphs.filter(row=>!isWithdrawnMessage(row));
  const removed=document.paragraphs.filter(isWithdrawnMessage).map(row=>row.paragraph);
  return {...document,source_paragraph_count:document.source_paragraph_count??document.paragraph_count,paragraph_count:rows.length,paragraphs:rows,withdrawn_paragraphs_removed:[...new Set([...(document.withdrawn_paragraphs_removed??[]),...removed])],withdrawn_display_filter:true};
}
