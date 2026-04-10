import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.Date;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.Statement;
import java.sql.Time;
import java.sql.Timestamp;
import java.sql.Types;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Properties;

public class OracleJdbcRunner {
  public static void main(String[] args) throws Exception {
    if (args.length < 3) {
      throw new IllegalArgumentException("Expected command, request path and response path.");
    }

    String command = args[0];
    Path requestPath = Path.of(args[1]);
    Path responsePath = Path.of(args[2]);

    Request request = Request.parse(Files.readString(requestPath, StandardCharsets.UTF_8));

    try {
      switch (command) {
        case "test" -> {
          testConnection(request);
          writeSuccess(responsePath, "{\"message\":\"Connection successful\"}");
        }
        case "open" -> {
          testConnection(request);
          writeSuccess(responsePath, "{\"message\":\"Connection opened\"}");
        }
        case "listDatabases" -> writeSuccess(responsePath, listItems(request, "SELECT SYS_CONTEXT('USERENV', 'DB_NAME') AS DB_NAME FROM dual"));
        case "listSchemas" -> writeSuccess(responsePath, listItems(request, "SELECT username FROM all_users WHERE username NOT IN ('SYS', 'SYSTEM') ORDER BY username"));
        case "listTables" -> writeSuccess(responsePath, listItems(request, "SELECT table_name FROM all_tables WHERE owner = '" + escapeSql(request.schema) + "' ORDER BY table_name"));
        case "listColumns" -> writeSuccess(responsePath, listColumns(request));
        case "executeQuery" -> writeSuccess(responsePath, executeQuery(request));
        default -> throw new IllegalArgumentException("Unsupported Oracle sidecar command: " + command);
      }
    } catch (Exception error) {
      writeError(responsePath, error);
      System.err.println(error.getMessage());
      System.exit(1);
    }
  }

  private static void testConnection(Request request) throws Exception {
    Class.forName("oracle.jdbc.OracleDriver");
    DriverManager.setLoginTimeout((int) Duration.ofSeconds(10).toSeconds());
    try (Connection connection = DriverManager.getConnection(request.jdbcUrl(), request.properties())) {
      connection.isValid(10);
    }
  }

  private static String listItems(Request request, String sql) throws Exception {
    try (Connection connection = DriverManager.getConnection(request.jdbcUrl(), request.properties());
         Statement statement = connection.createStatement();
         ResultSet resultSet = statement.executeQuery(sql)) {
      List<String> items = new ArrayList<>();

      while (resultSet.next()) {
        items.add(resultSet.getString(1));
      }

      return "{\"items\":" + toJsonArray(items) + "}";
    }
  }

  private static String listColumns(Request request) throws Exception {
    String sql =
        "SELECT column_name, data_type, nullable, data_default FROM all_tab_columns WHERE owner = '" + escapeSql(request.schema) +
        "' AND table_name = '" + escapeSql(request.table) + "' ORDER BY column_id";

    try (Connection connection = DriverManager.getConnection(request.jdbcUrl(), request.properties());
         Statement statement = connection.createStatement();
         ResultSet resultSet = statement.executeQuery(sql)) {
      StringBuilder json = new StringBuilder();
      json.append("{\"column_defs\":[");
      boolean first = true;

      while (resultSet.next()) {
        if (!first) {
          json.append(',');
        }
        first = false;
        json.append("{\"column_name\":")
            .append(quote(resultSet.getString(1)))
            .append(",\"data_type\":")
            .append(quote(resultSet.getString(2)))
            .append(",\"nullable\":")
            .append(String.valueOf("Y".equalsIgnoreCase(resultSet.getString(3))))
            .append(",\"default_value\":")
            .append(quote(trimToNull(resultSet.getString(4))))
            .append('}');
      }

      json.append("]}");
      return json.toString();
    }
  }

  private static String executeQuery(Request request) throws Exception {
    long startedAt = System.currentTimeMillis();
    String sql = normalizeExecutableSql(request.query);

    try (Connection connection = DriverManager.getConnection(request.jdbcUrl(), request.properties());
         Statement statement = connection.createStatement()) {
      statement.setQueryTimeout(30);
      boolean hasResultSet = statement.execute(sql);

      if (hasResultSet) {
        try (ResultSet resultSet = statement.getResultSet()) {
          ResultSetMetaData metaData = resultSet.getMetaData();
          int columnCount = metaData.getColumnCount();

          StringBuilder json = new StringBuilder();
          json.append("{\"columns\":[");

          for (int index = 1; index <= columnCount; index++) {
            if (index > 1) {
              json.append(',');
            }
            json.append(quote(metaData.getColumnLabel(index)));
          }

          json.append("],\"rows\":[");

          boolean firstRow = true;
          while (resultSet.next()) {
            if (!firstRow) {
              json.append(',');
            }
            firstRow = false;
            json.append('{');

            for (int index = 1; index <= columnCount; index++) {
              if (index > 1) {
                json.append(',');
              }

              json.append(quote(metaData.getColumnLabel(index)))
                  .append(':')
                  .append(toJsonValue(resultSet, metaData, index));
            }

            json.append('}');
          }

          json.append("],\"execution_time\":")
              .append(System.currentTimeMillis() - startedAt)
              .append('}');

          return json.toString();
        }
      }

      connection.commit();
      return "{\"columns\":[\"Rows Affected\"],\"rows\":[{\"Rows Affected\":"
          + statement.getUpdateCount()
          + "}],\"execution_time\":"
          + (System.currentTimeMillis() - startedAt)
          + "}";
    }
  }

  private static String toJsonArray(List<String> items) {
    StringBuilder json = new StringBuilder("[");
    for (int index = 0; index < items.size(); index++) {
      if (index > 0) {
        json.append(',');
      }
      json.append(quote(items.get(index)));
    }
    json.append(']');
    return json.toString();
  }

  private static String toJsonValue(ResultSet resultSet, ResultSetMetaData metaData, int index) throws Exception {
    int jdbcType = metaData.getColumnType(index);
    String columnTypeName = metaData.getColumnTypeName(index).toUpperCase(Locale.ROOT);

    if (jdbcType == Types.DATE) {
      Date value = resultSet.getDate(index);
      return value == null ? "null" : quote(value.toLocalDate().toString());
    }

    if (jdbcType == Types.TIME || jdbcType == Types.TIME_WITH_TIMEZONE) {
      Time value = resultSet.getTime(index);
      return value == null ? "null" : quote(value.toLocalTime().toString());
    }

    if (jdbcType == Types.TIMESTAMP) {
      Timestamp value = resultSet.getTimestamp(index);
      return value == null ? "null" : quote(value.toLocalDateTime().toString());
    }

    if (jdbcType == Types.TIMESTAMP_WITH_TIMEZONE) {
      try {
        OffsetDateTime value = resultSet.getObject(index, OffsetDateTime.class);
        if (value != null) {
          return quote(value.toString());
        }
      } catch (Exception ignored) {
      }

      try {
        ZonedDateTime value = resultSet.getObject(index, ZonedDateTime.class);
        if (value != null) {
          return quote(value.toString());
        }
      } catch (Exception ignored) {
      }
    }

    if (columnTypeName.contains("TIMESTAMP")) {
      String timestampValue = timestampAsString(resultSet, index);
      if (timestampValue != null) {
        return quote(timestampValue);
      }
    }

    if ("DATE".equals(columnTypeName)) {
      String dateValue = dateAsString(resultSet, index);
      if (dateValue != null) {
        return quote(dateValue);
      }
    }

    Object value = resultSet.getObject(index);
    if (value == null) {
      return "null";
    }
    if (isOracleTemporalValue(value)) {
      String temporalValue = temporalObjectAsString(resultSet, value, index);
      if (temporalValue != null) {
        return quote(temporalValue);
      }
    }
    if (value instanceof Number || value instanceof Boolean) {
      return value.toString();
    }
    return quote(String.valueOf(value));
  }

  private static boolean isOracleTemporalValue(Object value) {
    String className = value.getClass().getName();
    return className.startsWith("oracle.sql.TIMESTAMP")
        || className.startsWith("oracle.sql.DATE")
        || className.startsWith("oracle.sql.TIME");
  }

  private static String temporalObjectAsString(ResultSet resultSet, Object value, int index) throws Exception {
    String className = value.getClass().getName();

    if (className.startsWith("oracle.sql.TIMESTAMP")) {
      String timestampValue = timestampAsString(resultSet, index);
      if (timestampValue != null) {
        return timestampValue;
      }
    }

    if (className.startsWith("oracle.sql.DATE")) {
      String dateValue = dateAsString(resultSet, index);
      if (dateValue != null) {
        return dateValue;
      }
    }

    String stringValue = resultSet.getString(index);
    if (stringValue != null && !stringValue.startsWith("oracle.sql.")) {
      return stringValue;
    }

    return null;
  }

  private static String timestampAsString(ResultSet resultSet, int index) throws Exception {
    try {
      Timestamp value = resultSet.getTimestamp(index);
      if (value != null) {
        return value.toLocalDateTime().toString();
      }
    } catch (Exception ignored) {
    }

    try {
      OffsetDateTime value = resultSet.getObject(index, OffsetDateTime.class);
      if (value != null) {
        return value.toString();
      }
    } catch (Exception ignored) {
    }

    try {
      ZonedDateTime value = resultSet.getObject(index, ZonedDateTime.class);
      if (value != null) {
        return value.toString();
      }
    } catch (Exception ignored) {
    }

    String stringValue = resultSet.getString(index);
    if (stringValue != null && !stringValue.startsWith("oracle.sql.")) {
      return stringValue;
    }

    return null;
  }

  private static String dateAsString(ResultSet resultSet, int index) throws Exception {
    try {
      Timestamp value = resultSet.getTimestamp(index);
      if (value != null) {
        return value.toLocalDateTime().toString();
      }
    } catch (Exception ignored) {
    }

    try {
      Date value = resultSet.getDate(index);
      if (value != null) {
        return value.toLocalDate().toString();
      }
    } catch (Exception ignored) {
    }

    String stringValue = resultSet.getString(index);
    if (stringValue != null && !stringValue.startsWith("oracle.sql.")) {
      return stringValue;
    }

    return null;
  }

  private static String quote(String value) {
    if (value == null) {
      return "null";
    }
    String escaped = value
        .replace("\\", "\\\\")
        .replace("\"", "\\\"")
        .replace("\n", "\\n")
        .replace("\r", "\\r")
        .replace("\t", "\\t");
    return "\"" + escaped + "\"";
  }

  private static String escapeSql(String value) {
    return value == null ? "" : value.replace("'", "''").toUpperCase(Locale.ROOT);
  }

  private static String normalizeExecutableSql(String sql) {
    if (sql == null) {
      return "";
    }

    String normalized = sql.trim();

    while (normalized.endsWith(";") || normalized.endsWith("/")) {
      normalized = normalized.substring(0, normalized.length() - 1).trim();
    }

    return normalized;
  }

  private static String trimToNull(String value) {
    if (value == null) {
      return null;
    }

    String trimmed = value.trim();
    return trimmed.isEmpty() ? null : trimmed;
  }

  private static void writeSuccess(Path responsePath, String payload) throws IOException {
    Files.writeString(responsePath, payload, StandardCharsets.UTF_8);
  }

  private static void writeError(Path responsePath, Exception error) throws IOException {
    String message = quote("Oracle JDBC sidecar error: " + error.getMessage());
    Files.writeString(responsePath, "{\"error\":" + message + "}", StandardCharsets.UTF_8);
  }

  private static final class Request {
    final String host;
    final int port;
    final String database;
    final String oracleConnectionType;
    final String user;
    final String password;
    final String oracleDriverProperties;
    final String query;
    final String schema;
    final String table;

    Request(String host, int port, String database, String oracleConnectionType, String user, String password, String oracleDriverProperties, String query, String schema, String table) {
      this.host = host;
      this.port = port;
      this.database = database;
      this.oracleConnectionType = oracleConnectionType;
      this.user = user;
      this.password = password;
      this.oracleDriverProperties = oracleDriverProperties;
      this.query = query;
      this.schema = schema;
      this.table = table;
    }

    String jdbcUrl() {
      if ("sid".equalsIgnoreCase(oracleConnectionType)) {
        return "jdbc:oracle:thin:@" + host + ":" + port + ":" + database;
      }
      return "jdbc:oracle:thin:@//" + host + ":" + port + "/" + database;
    }

    Properties properties() {
      Properties props = new Properties();
      props.setProperty("user", user);
      props.setProperty("password", password);
      props.setProperty("oracle.net.disableOob", "true");
      props.setProperty("oracle.jdbc.ReadTimeout", String.valueOf(Duration.ofSeconds(30).toMillis()));
      props.setProperty("oracle.net.CONNECT_TIMEOUT", String.valueOf(Duration.ofSeconds(10).toMillis()));
      props.setProperty("oracle.jdbc.defaultConnectionValidation", "NETWORK");
      props.setProperty("defaultRowPrefetch", "10");

      for (String line : oracleDriverProperties == null ? new String[0] : oracleDriverProperties.split("\\R")) {
        String trimmed = line.trim();
        if (trimmed.isEmpty() || trimmed.startsWith("#")) {
          continue;
        }

        int separatorIndex = trimmed.indexOf('=');
        if (separatorIndex <= 0) {
          continue;
        }

        String key = trimmed.substring(0, separatorIndex).trim();
        String value = trimmed.substring(separatorIndex + 1).trim();

        if (!key.isEmpty()) {
          props.setProperty(key, value);
        }
      }

      return props;
    }

    static Request parse(String json) {
      return new Request(
          extractString(json, "host"),
          Integer.parseInt(extractNumber(json, "port")),
          extractString(json, "database"),
          extractString(json, "oracle_connection_type"),
          extractString(json, "user"),
          extractString(json, "password"),
          extractNullableString(json, "oracle_driver_properties"),
          extractNullableString(json, "query"),
          extractNullableString(json, "schema"),
          extractNullableString(json, "table")
      );
    }

    private static String extractString(String json, String field) {
      String value = extractNullableString(json, field);
      return value == null ? "" : value;
    }

    private static String extractNullableString(String json, String field) {
      String needle = "\"" + field + "\":";
      int start = json.indexOf(needle);
      if (start < 0) {
        return null;
      }

      int valueStart = start + needle.length();
      while (valueStart < json.length() && Character.isWhitespace(json.charAt(valueStart))) {
        valueStart++;
      }

      if (json.startsWith("null", valueStart)) {
        return null;
      }

      if (json.charAt(valueStart) != '"') {
        throw new IllegalArgumentException("Invalid JSON payload for field " + field);
      }

      StringBuilder value = new StringBuilder();
      boolean escaped = false;
      for (int index = valueStart + 1; index < json.length(); index++) {
        char current = json.charAt(index);
        if (escaped) {
          switch (current) {
            case 'n' -> value.append('\n');
            case 'r' -> value.append('\r');
            case 't' -> value.append('\t');
            default -> value.append(current);
          }
          escaped = false;
        } else if (current == '\\') {
          escaped = true;
        } else if (current == '"') {
          return value.toString();
        } else {
          value.append(current);
        }
      }

      throw new IllegalArgumentException("Unterminated JSON string for field " + field);
    }

    private static String extractNumber(String json, String field) {
      String needle = "\"" + field + "\":";
      int start = json.indexOf(needle);
      if (start < 0) {
        throw new IllegalArgumentException("Missing numeric field " + field);
      }

      int valueStart = start + needle.length();
      while (valueStart < json.length() && Character.isWhitespace(json.charAt(valueStart))) {
        valueStart++;
      }

      int valueEnd = valueStart;
      while (valueEnd < json.length() && Character.isDigit(json.charAt(valueEnd))) {
        valueEnd++;
      }

      return json.substring(valueStart, valueEnd);
    }
  }
}
