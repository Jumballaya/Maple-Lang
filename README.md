# Maple

WASM first programming language

## Example

```
import malloc, free from "memory"
import init_screen, draw_screen, destroy_screen from "graphics"

// from "graphics"
//  struct Color {
//    r: f32,
//    g: f32,
//    b: f32,
//    a: f32
//  }
//

fn create_color_array_and_fill(count: i32, r: f32, g: f32, b: f32, a: f32): Color[] {
  let colors: Color[] = malloc(Color * count);
  for (let i: i32 = 0; i < count; i++) {
    colors[i]->r = r;
    colors[i]->g = g;
    colors[i]->b = b;
    colors[i]->a = a;
  }
}

fn main(): void {
  let w: i32 = 128;
  let h: i32 = 128;
  let colors: Color[] = create_color_array_and_fill(w * h, 0.86, 0.02, 0.14);
  let screen: *GFXScreen = init_screen(w, h);

  draw_screen(screen, colors);
  destroy_screen(screen);
  free(colors);
}

```
