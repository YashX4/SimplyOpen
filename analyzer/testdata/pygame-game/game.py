"""Star Catcher: move the basket to catch falling stars. Built with pygame."""
import random
import sys

import pygame

WIDTH, HEIGHT = 640, 480


def main() -> None:
    pygame.init()
    screen = pygame.display.set_mode((WIDTH, HEIGHT))
    pygame.display.set_caption("Star Catcher")
    clock = pygame.time.Clock()
    basket = pygame.image.load("assets/basket.png")
    star = pygame.image.load("assets/star.png")
    ding = pygame.mixer.Sound("assets/ding.wav")

    x, stars, score, paused = WIDTH // 2, [], 0, False
    while True:
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                pygame.quit()
                sys.exit()
            if event.type == pygame.KEYDOWN:
                if event.key == pygame.K_ESCAPE:
                    pygame.quit()
                    sys.exit()
                if event.key == pygame.K_p:
                    paused = not paused
        keys = pygame.key.get_pressed()
        if not paused:
            if keys[pygame.K_LEFT] or keys[pygame.K_a]:
                x -= 6
            if keys[pygame.K_RIGHT] or keys[pygame.K_d]:
                x += 6
            if random.random() < 0.03:
                stars.append([random.randint(0, WIDTH - 32), 0])
            for s in stars:
                s[1] += 4
            caught = [s for s in stars if s[1] > HEIGHT - 64 and abs(s[0] - x) < 48]
            score += len(caught)
            if caught:
                ding.play()
            stars = [s for s in stars if s not in caught and s[1] < HEIGHT]
        screen.fill((10, 10, 40))
        for s in stars:
            screen.blit(star, s)
        screen.blit(basket, (x, HEIGHT - 64))
        pygame.display.flip()
        clock.tick(60)


if __name__ == "__main__":
    main()
