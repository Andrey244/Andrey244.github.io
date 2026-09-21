#property strict
#property version   "1.11"
#property description "Read-only MT4 -> Supabase connector for the zero-cost trading journal."
#property description "It never opens, modifies or closes trades."

input string SupabaseUrl      = "https://ylriyjxcefovzwzinpqd.supabase.co";
input string SupabaseAnonKey  = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inlscml5anhjZWZvdnp3emlucHFkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk5ODAxNzAsImV4cCI6MjEwNTU1NjE3MH0.Y95Tu9GzSPwVfV1kpMBKxQ1ozE0LUXuJDjjkD-bhi78";
input string IngestToken      = "YOUR_PRIVATE_INGEST_TOKEN";
input int    InitialSyncDays  = 180;
input int    SyncEverySeconds = 30;
input int    BatchSize        = 50;
input bool   PrintDebug       = true;

string STATE_NAME;

int OnInit()
{
   STATE_NAME = "TJ4_LAST_" + IntegerToString(AccountNumber());
   EventSetTimer((int)MathMax(10, SyncEverySeconds));
   Print("TradeJournal MT4 connector v1.11 started. READ-ONLY.");
   if(!TestConnection())
      Print("Journal connection test failed. Fix the log error before expecting sync.");
   else
      SyncHistory();
   return(INIT_SUCCEEDED);
}

void OnDeinit(const int reason)
{
   EventKillTimer();
}

void OnTimer()
{
   SyncHistory();
}

void SyncHistory()
{
   if(StringFind(SupabaseUrl,"YOUR_PROJECT") >= 0 || StringLen(IngestToken) < 20 || StringLen(SupabaseAnonKey) < 20)
   {
      if(PrintDebug) Print("Journal connector is not configured yet.");
      return;
   }

   long last_ms = 0;
   if(GlobalVariableCheck(STATE_NAME)) last_ms = (long)GlobalVariableGet(STATE_NAME);
   datetime cutoff = (last_ms > 0)
      ? (datetime)MathMax(0, (last_ms/1000) - 120)
      : TimeCurrent() - (datetime)(MathMax(1,InitialSyncDays) * 86400);

   int total = OrdersHistoryTotal();
   if(PrintDebug) Print("Journal history scan: OrdersHistoryTotal=", total, ", cutoff=", TimeToString(cutoff, TIME_DATE|TIME_MINUTES));
   if(total <= 0)
   {
      Print("Journal: MT4 currently exposes 0 closed history orders. Open Terminal -> Account History, right-click, choose All History, then wait up to ", MathMax(10,SyncEverySeconds), " seconds.");
      return;
   }

   string batch = "";
   int batch_count = 0;
   long max_ms_in_batch = last_ms;
   long max_ms_success = last_ms;

   for(int i=0; i<total; i++)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_HISTORY)) continue;
      int type = OrderType();
      if(type != OP_BUY && type != OP_SELL) continue;
      if(OrderCloseTime() <= 0 || OrderCloseTime() < cutoff) continue;

      long close_ms = (long)OrderCloseTime() * 1000;
      string obj = OrderToJson();
      if(obj == "") continue;

      if(batch_count > 0) batch += ",";
      batch += obj;
      batch_count++;
      if(close_ms > max_ms_in_batch) max_ms_in_batch = close_ms;

      if(batch_count >= MathMax(1,BatchSize))
      {
         if(!PostBatch(batch))
         {
            Print("Journal upload stopped after HTTP failure. It will retry next timer tick.");
            return;
         }
         max_ms_success = MathMax(max_ms_success, max_ms_in_batch);
         GlobalVariableSet(STATE_NAME, (double)max_ms_success);
         batch = "";
         batch_count = 0;
         max_ms_in_batch = max_ms_success;
      }
   }

   if(batch_count > 0)
   {
      if(!PostBatch(batch)) return;
      max_ms_success = MathMax(max_ms_success, max_ms_in_batch);
      GlobalVariableSet(STATE_NAME, (double)max_ms_success);
   }

   if(PrintDebug && max_ms_success > last_ms)
      Print("Journal sync OK. Last close time ms: ", max_ms_success);
}

string OrderToJson()
{
   int type = OrderType();
   string side = type == OP_BUY ? "BUY" : "SELL";
   long open_ms = (long)OrderOpenTime() * 1000;
   long close_ms = (long)OrderCloseTime() * 1000;

   string j = "{";
   j += "\"source\":\"MT4\",";
   j += "\"account\":\"" + IntegerToString(AccountNumber()) + "\",";
   j += "\"server\":\"" + JsonEscape(AccountServer()) + "\",";
   j += "\"event_id\":\"" + IntegerToString(OrderTicket()) + "\",";
   j += "\"order_id\":\"" + IntegerToString(OrderTicket()) + "\",";
   j += "\"event_time_ms\":" + DoubleToString((double)close_ms,0) + ",";
   j += "\"open_time_ms\":" + DoubleToString((double)open_ms,0) + ",";
   j += "\"close_time_ms\":" + DoubleToString((double)close_ms,0) + ",";
   j += "\"symbol\":\"" + JsonEscape(OrderSymbol()) + "\",";
   j += "\"side\":\"" + side + "\",";
   j += "\"entry_type\":\"ORDER\",";
   j += "\"volume\":" + D(OrderLots(),8) + ",";
   j += "\"price\":" + D(OrderOpenPrice(),10) + ",";
   j += "\"open_price\":" + D(OrderOpenPrice(),10) + ",";
   j += "\"close_price\":" + D(OrderClosePrice(),10) + ",";
   j += "\"profit\":" + D(OrderProfit(),2) + ",";
   j += "\"commission\":" + D(OrderCommission(),2) + ",";
   j += "\"swap\":" + D(OrderSwap(),2) + ",";
   j += "\"fee\":0,";
   j += "\"magic\":\"" + IntegerToString(OrderMagicNumber()) + "\",";
   j += "\"comment\":\"" + JsonEscape(OrderComment()) + "\",";
   j += "\"status\":\"CLOSED\"";
   j += "}";
   return j;
}

bool TestConnection()
{
   if(StringLen(IngestToken) < 20)
   {
      Print("Journal connection test skipped: IngestToken is not set.");
      return false;
   }

   if(PostBatch(""))
   {
      Print("Journal connection test OK.");
      return true;
   }

   return false;
}

bool PostBatch(string events_json)
{
   string base = SupabaseUrl;
   while(StringLen(base) > 0 && StringSubstr(base,StringLen(base)-1,1) == "/")
      base = StringSubstr(base,0,StringLen(base)-1);

   string url = base + "/rest/v1/rpc/ingest_mt_events";
   string body = "{\"p_token\":\"" + JsonEscape(IngestToken) + "\",\"p_events\":[" + events_json + "]}";
   string headers = "Content-Type: application/json\r\n";
   headers += "apikey: " + SupabaseAnonKey + "\r\n";
   headers += "Authorization: Bearer " + SupabaseAnonKey + "\r\n";

   char data[];
   char result[];
   string response_headers;
   StringToCharArray(body, data, 0, WHOLE_ARRAY, CP_UTF8);
   if(ArraySize(data) > 0) ArrayResize(data, ArraySize(data)-1);

   ResetLastError();
   int code = WebRequest("POST", url, headers, 15000, data, result, response_headers);
   string response = CharArrayToString(result, 0, -1, CP_UTF8);

   if(code >= 200 && code < 300)
   {
      if(PrintDebug) Print("Journal HTTP ", code, " -> ", response);
      return true;
   }

   Print("Journal HTTP failed. code=", code, " err=", GetLastError(), " response=", response);
   Print("Check Tools -> Options -> Expert Advisors -> Allow WebRequest for: ", base);
   return false;
}

string D(double v, int digits)
{
   return DoubleToString(v, digits);
}

string JsonEscape(string s)
{
   StringReplace(s, "\\", "\\\\");
   StringReplace(s, "\"", "\\\"");
   StringReplace(s, "\r", "\\r");
   StringReplace(s, "\n", "\\n");
   StringReplace(s, "\t", "\\t");
   return s;
}
