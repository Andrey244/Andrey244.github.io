#property strict
#property version   "0.11"
#property description "One-shot read-only MT4 history exporter for Trading Journal Collector."
#property description "It never opens, modifies or closes trades."

const int TJ_OP_BALANCE = 6;
const int TJ_OP_CREDIT  = 7;

input string OutputFile = "tj_export.jsonl";
input string StatusFile = "tj_status.json";
input string CursorFile = "tj_since_ms.txt";
input int InitialSyncDays = 730;
input bool PrintDebug = true;

void OnStart()
{
   FileDelete(OutputFile);
   FileDelete(StatusFile);

   bool connected = (bool)TerminalInfoInteger(TERMINAL_CONNECTED);
   bool trade_allowed = (bool)AccountInfoInteger(ACCOUNT_TRADE_ALLOWED);
   string account = IntegerToString(AccountNumber());
   string server = AccountServer();

   if(!connected)
   {
      WriteStatus(false, trade_allowed, account, server, 0, -1, "TERMINAL_DISCONNECTED");
      return;
   }

   if(trade_allowed)
   {
      Print("Trading Journal Collector rejected account: trading is allowed. Use Investor Password.");
      WriteStatus(true, true, account, server, 0, -1, "WRITE_CAPABLE_CREDENTIAL");
      return;
   }

   int handle = FileOpen(OutputFile, FILE_WRITE|FILE_TXT|FILE_ANSI);
   if(handle == INVALID_HANDLE)
   {
      int err = GetLastError();
      WriteStatus(true, false, account, server, 0, -1, "OUTPUT_OPEN_FAILED_" + IntegerToString(err));
      return;
   }

   long since_ms = ReadSinceMs();
   datetime cutoff = since_ms > 0
      ? (datetime)(since_ms / 1000)
      : TimeCurrent() - (datetime)(MathMax(1, InitialSyncDays) * 86400);

   int total = OrdersHistoryTotal();
   int exported = 0;

   for(int i=0; i<total; i++)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_HISTORY)) continue;
      int type = OrderType();
      bool is_trade = (type == OP_BUY || type == OP_SELL);
      bool is_cash = (type == TJ_OP_BALANCE || type == TJ_OP_CREDIT);
      if(!is_trade && !is_cash) continue;

      datetime event_time = is_cash ? OrderOpenTime() : OrderCloseTime();
      if(event_time <= 0 || event_time < cutoff) continue;

      string obj = OrderToJson();
      if(obj == "") continue;
      FileWriteString(handle, obj + "\r\n");
      exported++;
   }

   FileFlush(handle);
   FileClose(handle);
   WriteStatus(true, false, account, server, exported, total, "OK");

   if(PrintDebug)
      Print("Trading Journal Collector exported ", exported,
            " MT4 history rows from terminal history total=", total, ". READ-ONLY.");
}

long ReadSinceMs()
{
   int handle = FileOpen(CursorFile, FILE_READ|FILE_TXT|FILE_ANSI);
   if(handle == INVALID_HANDLE)
      return 0;

   string value = FileReadString(handle);
   FileClose(handle);
   FileDelete(CursorFile);

   double parsed = StringToDouble(value);
   if(parsed <= 0)
      return 0;
   return (long)parsed;
}

void WriteStatus(bool connected, bool trade_allowed, string account, string server,
                 int exported, int history_total, string code)
{
   int handle = FileOpen(StatusFile, FILE_WRITE|FILE_TXT|FILE_ANSI);
   if(handle == INVALID_HANDLE) return;

   string j = "{";
   j += "\"source\":\"MT4\",";
   j += "\"connected\":" + BoolJson(connected) + ",";
   j += "\"trade_allowed\":" + BoolJson(trade_allowed) + ",";
   j += "\"account\":\"" + JsonEscape(account) + "\",";
   j += "\"server\":\"" + JsonEscape(server) + "\",";
   j += "\"exported\":" + IntegerToString(exported) + ",";
   j += "\"history_total\":" + IntegerToString(history_total) + ",";
   j += "\"code\":\"" + JsonEscape(code) + "\"";
   j += "}";

   FileWriteString(handle, j);
   FileFlush(handle);
   FileClose(handle);
}

string OrderToJson()
{
   int type = OrderType();
   bool is_cash = (type == TJ_OP_BALANCE || type == TJ_OP_CREDIT);
   long open_ms = (long)OrderOpenTime() * 1000;
   long close_ms = (long)OrderCloseTime() * 1000;
   long event_ms = is_cash ? open_ms : close_ms;

   string j = "{";
   j += "\"source\":\"MT4\",";
   j += "\"account\":\"" + IntegerToString(AccountNumber()) + "\",";
   j += "\"server\":\"" + JsonEscape(AccountServer()) + "\",";
   j += "\"event_id\":\"" + IntegerToString(OrderTicket()) + "\",";
   j += "\"order_id\":\"" + IntegerToString(OrderTicket()) + "\",";
   j += "\"event_time_ms\":" + DoubleToString((double)event_ms,0) + ",";
   j += "\"collector_version\":\"0.11\",";

   if(is_cash)
   {
      string entry = type == TJ_OP_CREDIT ? "CREDIT" : "BALANCE";
      j += "\"symbol\":\"CASH\",";
      j += "\"entry_type\":\"" + entry + "\",";
      j += "\"volume\":0,";
      j += "\"profit\":" + D(OrderProfit(),2) + ",";
      j += "\"commission\":0,";
      j += "\"swap\":0,";
      j += "\"fee\":0,";
      j += "\"magic\":\"0\",";
      j += "\"comment\":\"" + JsonEscape(OrderComment()) + "\",";
      j += "\"status\":\"CLOSED\"";
      j += "}";
      return j;
   }

   string side = type == OP_BUY ? "BUY" : "SELL";
   double sl = OrderStopLoss();
   double tp = OrderTakeProfit();
   double close_px = OrderClosePrice();
   double point = MarketInfo(OrderSymbol(), MODE_POINT);
   if(point <= 0) point = 0.00001;
   double tol = point * 30.0;
   bool closed_by_sl = false;
   string order_comment = OrderComment();
   StringToLower(order_comment);

   if(StringFind(order_comment,"[sl]") >= 0 ||
      StringFind(order_comment,"stop loss") >= 0 ||
      StringFind(order_comment,"stoploss") >= 0)
      closed_by_sl = true;

   if(!closed_by_sl && sl > 0)
   {
      if(type == OP_BUY && close_px <= sl + tol) closed_by_sl = true;
      if(type == OP_SELL && close_px >= sl - tol) closed_by_sl = true;
   }

   j += "\"open_time_ms\":" + DoubleToString((double)open_ms,0) + ",";
   j += "\"close_time_ms\":" + DoubleToString((double)close_ms,0) + ",";
   j += "\"symbol\":\"" + JsonEscape(OrderSymbol()) + "\",";
   j += "\"side\":\"" + side + "\",";
   j += "\"entry_type\":\"ORDER\",";
   j += "\"volume\":" + D(OrderLots(),8) + ",";
   j += "\"price\":" + D(OrderOpenPrice(),10) + ",";
   j += "\"open_price\":" + D(OrderOpenPrice(),10) + ",";
   j += "\"close_price\":" + D(OrderClosePrice(),10) + ",";
   j += "\"stop_loss\":" + D(sl,10) + ",";
   j += "\"take_profit\":" + D(tp,10) + ",";
   j += "\"closed_by_sl\":" + BoolJson(closed_by_sl) + ",";
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

string BoolJson(bool v)
{
   return v ? "true" : "false";
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
