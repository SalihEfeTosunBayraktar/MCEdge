import com.sun.source.tree.CompilationUnitTree;
import com.sun.source.tree.Tree;
import com.sun.source.util.JavacTask;
import java.io.IOException;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Set;
import java.util.stream.Stream;
import javax.lang.model.element.Name;
import javax.tools.JavaCompiler;
import javax.tools.JavaFileObject;
import javax.tools.StandardJavaFileManager;
import javax.tools.ToolProvider;

/**
 * Parses every .java file of a directory (syntax only, nothing is resolved) and writes each tree as JSON beside the
 * given output directory. Generic on purpose: a node's fields are the getters of its com.sun.source interface, so no
 * tree kind needs its own code. usage: java JavaAst.java <input dir> <output dir>
 */
public class JavaAst {
  private static final Set<String> SKIPPED = Set.of("getKind", "getClass", "hashCode", "toString", "getStartPosition", "getEndPosition");

  public static void main(String[] args) throws IOException {
    Path in = Path.of(args[0]);
    Path out = Path.of(args[1]);
    Files.createDirectories(out);
    List<Path> files;
    try (Stream<Path> list = Files.list(in)) {
      files = list.filter(p -> p.toString().endsWith(".java")).sorted(Comparator.naturalOrder()).toList();
    }
    JavaCompiler compiler = ToolProvider.getSystemJavaCompiler();
    try (StandardJavaFileManager manager = compiler.getStandardFileManager(null, null, StandardCharsets.UTF_8)) {
      Iterable<? extends JavaFileObject> sources = manager.getJavaFileObjectsFromPaths(files);
      JavacTask task = (JavacTask) compiler.getTask(null, manager, null, List.of("-proc:none"), null, sources);
      for (CompilationUnitTree unit : task.parse()) {
        String name = Path.of(unit.getSourceFile().toUri()).getFileName().toString().replace(".java", ".json");
        StringBuilder json = new StringBuilder();
        write(unit, json);
        Files.writeString(out.resolve(name), json, StandardCharsets.UTF_8);
      }
    }
  }

  private static void write(Object value, StringBuilder json) {
    if (value == null) {
      json.append("null");
    } else if (value instanceof Tree tree) {
      writeTree(tree, json);
    } else if (value instanceof Iterable<?> list) {
      List<String> parts = new ArrayList<>();
      for (Object item : list) {
        StringBuilder part = new StringBuilder();
        write(item, part);
        parts.add(part.toString());
      }
      json.append('[').append(String.join(",", parts)).append(']');
    } else if (value instanceof Boolean) {
      json.append(value);
    } else if (value instanceof Number number) {
      double d = number.doubleValue();
      json.append(Double.isFinite(d) ? number.toString() : "null");
    } else {
      quote(value.toString(), json);
    }
  }

  private static void writeTree(Tree tree, StringBuilder json) {
    Class<? extends Tree> type = tree.getKind().asInterface();
    json.append("{\"k\":");
    quote(tree.getKind().name(), json);
    if (type == null) {
      json.append('}');
      return;
    }
    for (Method method : type.getMethods()) {
      String name = method.getName();
      if (method.getParameterCount() != 0 || SKIPPED.contains(name) || !(name.startsWith("get") || name.startsWith("is"))) continue;
      Object value;
      try {
        value = method.invoke(tree);
      } catch (ReflectiveOperationException | RuntimeException e) {
        continue;
      }
      if (value == null) continue;
      if (value instanceof Name) value = value.toString();
      json.append(',');
      quote(name.startsWith("get") ? Character.toLowerCase(name.charAt(3)) + name.substring(4) : name, json);
      json.append(':');
      write(value, json);
    }
    json.append('}');
  }

  private static void quote(String text, StringBuilder json) {
    json.append('"');
    for (char c : text.toCharArray()) {
      switch (c) {
        case '"' -> json.append("\\\"");
        case '\\' -> json.append("\\\\");
        case '\n' -> json.append("\\n");
        case '\r' -> json.append("\\r");
        case '\t' -> json.append("\\t");
        default -> {
          if (c < 0x20) json.append(String.format("\\u%04x", (int) c));
          else json.append(c);
        }
      }
    }
    json.append('"');
  }
}
