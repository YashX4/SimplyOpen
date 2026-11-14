"""A tiny pygame window that draws a star loaded from assets/ (relative to where it's started)."""
import pygame


def main() -> None:
    pygame.init()
    screen = pygame.display.set_mode((320, 240))
    star = pygame.image.load("assets/star.png")
    running = True
    while running:
        for event in pygame.event.get():
            if event.type == pygame.QUIT or (event.type == pygame.KEYDOWN and event.key == pygame.K_ESCAPE):
                running = False
        screen.blit(star, (144, 104))
        pygame.display.flip()
    pygame.quit()


if __name__ == "__main__":
    main()
