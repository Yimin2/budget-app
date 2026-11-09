'use client';

import { useSearchParams } from 'next/navigation';
import { CheckView } from './CheckView';
import { parseAmountParam } from './selectors';

/** 주소의 ?amount= · ?source= 를 읽어 CheckView 를 그려요. 주소가 바뀌면 처음부터 다시 그려요 */
export function CheckScreen() {
  const params = useSearchParams();
  const amount = parseAmountParam(params.get('amount'));
  const source = params.get('source') === 'event' ? 'event' : 'living';
  return <CheckView key={`${amount ?? ''}|${source}`} initialAmount={amount} initialSource={source} />;
}
